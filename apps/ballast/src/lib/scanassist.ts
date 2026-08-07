// scanassist.ts
// Pure. A small video frame in, "where's the receipt and what's wrong with the
// framing" out. No DOM, no camera — the camera plumbing lives in
// ScanCamera.tsx; this file is the part with opinions, so it's the part with
// tests.
//
// This is deliberately NOT a document scanner. OpenCV.js would do beautiful
// perspective-corrected quad detection and cost ~8MB of WASM — the HEIC lesson
// says no. A receipt is a specific easy case: a bright, roughly rectangular
// region on a darker background. Finding "the largest bright blob and its
// bounding box" is a few dozen lines, runs at video rate on a 96px thumbnail,
// and is exactly enough to answer the only questions the assist asks:
// is the receipt in frame, whole, close enough, and free of glare?
//
// Everything here mirrors a failure the reader actually met in the field:
//   - "move closer"       → tiny receipt in a big frame read as noise
//   - "part out of frame" → the card slip carries the total's extra witnesses
//                           (see findTotal's vote), so a cropped bottom costs
//                           corroboration, not just pixels
//   - "glare"             → blown-out thermal paper took digits with it

export type Frame = {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, width*height*4
};

// All fractions of frame size, 0..1 — the overlay scales them to the screen.
export type Region = { x: number; y: number; w: number; h: number };

export type Hint =
  | "searching" // no paper-like region found
  | "cut-off-bottom" // bottom edge clipped — where the total's witnesses live
  | "cut-off" // another edge clipped
  | "closer" // region too small to read well
  | "glare" // blown-out highlights on the paper
  | "good";

export type Assessment = { region: Region | null; hint: Hint };

// Tunables, named so the tests can speak the same language.
export const MIN_REGION_FRACTION = 0.03; // below this a blob is noise, not paper
export const CLOSER_FRACTION = 0.14; // below this: readable, but barely
export const GLARE_LUMA = 252; // ~blown-out in 8-bit video
export const GLARE_FRACTION = 0.08; // this much of the paper blown = trouble

export function assess(frame: Frame): Assessment {
  const { width: w, height: h, data } = frame;
  const n = w * h;

  // Luminance + mean/σ in one walk. The paper is the bright mode; an adaptive
  // threshold (μ + σ/2) splits it from wood, cloth, and countertop without
  // caring what the lighting is doing today.
  const luma = new Uint8Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const y = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
    luma[i] = y;
    sum += y;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (luma[i] - mean) ** 2;
  const threshold = mean + Math.sqrt(varSum / n) / 2;

  // Largest bright connected component, 4-neighbour flood fill on the
  // thumbnail grid. At 96px wide this is thousands of cells, not millions.
  const seen = new Uint8Array(n);
  let best: number[] | null = null;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || luma[start] < threshold) continue;
    const component: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      component.push(p);
      const px = p % w;
      const neighbours = [p - w, p + w, px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1];
      for (const q of neighbours) {
        if (q < 0 || q >= n || seen[q] || luma[q] < threshold) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (!best || component.length > best.length) best = component;
  }

  if (!best || best.length / n < MIN_REGION_FRACTION) {
    return { region: null, hint: "searching" };
  }

  let minX = w, maxX = 0, minY = h, maxY = 0, glare = 0;
  for (const p of best) {
    const px = p % w;
    const py = (p - px) / w;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (luma[p] >= GLARE_LUMA) glare++;
  }
  const region: Region = {
    x: minX / w,
    y: minY / h,
    w: (maxX - minX + 1) / w,
    h: (maxY - minY + 1) / h,
  };

  // Hints in priority order — one at a time, calmly.
  const fraction = best.length / n;
  let hint: Hint = "good";
  if (maxY >= h - 1) hint = "cut-off-bottom";
  else if (minY <= 0 || minX <= 0 || maxX >= w - 1) hint = "cut-off";
  else if (fraction < CLOSER_FRACTION) hint = "closer";
  else if (glare / best.length > GLARE_FRACTION) hint = "glare";

  return { region, hint };
}

// The words, kept beside the logic so tone stays consistent. Calm, second
// person, never a command.
export const HINT_COPY: Record<Hint, string> = {
  searching: "Looking for the receipt…",
  "cut-off-bottom": "The bottom looks cut off — the card slip helps verify the total.",
  "cut-off": "Part of the receipt looks out of frame.",
  closer: "A little closer and the small print gets easier.",
  glare: "There's a shine on the paper — a small tilt usually clears it.",
  good: "Looks good — snap when ready.",
};
