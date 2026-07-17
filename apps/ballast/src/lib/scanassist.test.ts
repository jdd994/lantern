import { describe, it, expect } from "vitest";
import { assess, type Frame } from "./scanassist";

// Build a synthetic camera thumbnail: dark background, optionally a bright
// rectangle (the receipt) with optional blown-out glare inside it.
function frame(
  w: number,
  h: number,
  rect?: { x: number; y: number; w: number; h: number; glare?: boolean }
): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = 60 + ((x * 7 + y * 13) % 20); // dark, slightly textured table
      if (rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) {
        v = 210; // paper
        if (rect.glare && x < rect.x + rect.w / 2 && y < rect.y + rect.h / 2) v = 254;
      }
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe("assess: the scan assist's opinions", () => {
  it("finds a centred receipt and calls it good", () => {
    const a = assess(frame(96, 128, { x: 24, y: 20, w: 48, h: 88 }));
    expect(a.hint).toBe("good");
    expect(a.region).not.toBeNull();
    // The box lands on the paper, in frame fractions.
    expect(a.region!.x).toBeCloseTo(24 / 96, 1);
    expect(a.region!.w).toBeCloseTo(48 / 96, 1);
  });

  it("sees nothing on an empty table", () => {
    expect(assess(frame(96, 128)).hint).toBe("searching");
    expect(assess(frame(96, 128)).region).toBeNull();
  });

  it("notices the bottom is cut off — that's where the witnesses live", () => {
    const a = assess(frame(96, 128, { x: 24, y: 30, w: 48, h: 98 }));
    expect(a.hint).toBe("cut-off-bottom");
  });

  it("notices a side is cut off", () => {
    const a = assess(frame(96, 128, { x: 0, y: 20, w: 40, h: 80 }));
    expect(a.hint).toBe("cut-off");
  });

  it("asks for closer when the receipt is small in frame", () => {
    const a = assess(frame(96, 128, { x: 40, y: 50, w: 14, h: 30 }));
    expect(a.hint).toBe("closer");
  });

  it("notices glare on the paper", () => {
    const a = assess(frame(96, 128, { x: 20, y: 16, w: 56, h: 96, glare: true }));
    expect(a.hint).toBe("glare");
  });
});
