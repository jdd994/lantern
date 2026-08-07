// photo.ts — a picture of the thing you made.
//
// WHAT THIS IS NOT. It is not the FoodRecognizer seam (`recognize.ts`), and it
// must never quietly become it. Nothing here looks at the image: no model, no
// inference, no "we noticed this looks like pasta", no upload to anyone. The
// photo is shown back to you and to nobody else. That keeps it tier 0 — the same
// rung as typing a food in by hand — because no new party learns anything.
//
// It earns its place because most meals are thrown together: a photo of the pan
// is often a truer record than the words, and it's what makes coming back to
// curate a recipe a day later actually pleasant rather than archaeology.
//
// The bytes are sealed with everything else in the recipe record, so a photo is
// E2E encrypted exactly like an ingredient is. The server stores it as opaque
// ciphertext and cannot tell a photo from a shopping list.
//
// It is downscaled and re-encoded HERE, before it is ever sealed, for three
// reasons that all point the same way:
//   1. A modern phone photo is 3–8 MB. Sealed and base64'd it would be ~10 MB in
//      one sync record — that's not a record, that's an outage.
//   2. Re-encoding through a canvas DROPS EXIF. Phone photos carry GPS
//      coordinates, and a recipe that silently remembers your kitchen's latitude
//      is not something anyone asked for. Re-drawing keeps the pixels and
//      nothing else.
//   3. You don't need 12 megapixels to remember what dinner looked like.

// The long edge we downscale to, and the ceiling for the encoded result. 900px
// is generous on a phone screen at 2x, and the budget keeps a photo comfortably
// inside one sync record even after base64's 4/3 inflation.
export const MAX_EDGE = 900;
export const MAX_BYTES = 400_000;

// Quality ladder — we step down until the encoding fits the budget. Starting
// high because food photos are the kind of image JPEG handles well.
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5, 0.4];

// Pure, so it's testable without a canvas: the box an image fits into. Only ever
// shrinks — blowing a small photo up would invent detail that isn't there.
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Roughly how many bytes a data URL's payload occupies (base64 is 4 chars per 3
// bytes, minus any padding). Used to pick a quality, so an estimate is fine.
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export class PhotoTooLarge extends Error {
  constructor() {
    super("That photo is still too large after shrinking. Try a smaller one.");
  }
}

// Read a File the user picked into an image. Kept separate so the browser-only
// half is one small, obvious place.
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as a photo."));
    };
    img.src = url;
  });
}

// File → a small JPEG data URL, ready to be sealed. Async and browser-only; the
// arithmetic above is where the testable logic lives.
export async function shrinkPhoto(file: File): Promise<string> {
  const img = await loadImage(file);
  const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser wouldn't give us a canvas to shrink the photo with.");
  // Drawing the pixels is also what leaves EXIF behind — see the header.
  ctx.drawImage(img, 0, 0, width, height);

  let last = "";
  for (const q of QUALITY_STEPS) {
    last = canvas.toDataURL("image/jpeg", q);
    if (dataUrlBytes(last) <= MAX_BYTES) return last;
  }
  // Even at the bottom of the ladder it doesn't fit — say so plainly rather than
  // storing something that will fail to sync later, far from this moment.
  throw new PhotoTooLarge();
}
