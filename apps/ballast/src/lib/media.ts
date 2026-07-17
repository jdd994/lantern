// media.ts
// Client-side image handling: downscale + re-encode so receipt photos stay small.
// No IO and no crypto here — the caller encrypts before anything is stored.
//
// Ported from Driftless, including a lesson it paid for the hard way: iPhone
// photos are HEIC, desktop browsers can't decode HEIC, and the fix is NOT a
// multi-megabyte WASM converter. Driftless added one and then deleted it
// (commit 0ae3a1c) in favour of native decode plus a clear, actionable message.
// Don't re-add it here either.
//
// A receipt is a document, not a photograph, so it gets a slightly larger max
// edge than a Driftless polaroid: small print has to stay legible when you go
// back to check what that £47 actually was.

export const MAX_DIM = 2000; // longest edge, px — receipts need readable small print
export const QUALITY = 0.82;

// Chunked base64, so a large image doesn't overflow the call stack. Used to build
// data: URLs for display — the CSP allows `data:` for images but not `blob:`.
export function bytesToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function dataUrl(bytes: ArrayBuffer, type: string): string {
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

function isHeic(file: File): boolean {
  return /(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

// Downscale + re-encode to JPEG. Throws rather than storing an unviewable blob,
// so the caller can say something true instead of showing a white rectangle.
//
// Photographing a receipt from a phone works: iOS hands the browser a JPEG, or
// WebKit decodes the HEIC natively. A raw .heic dragged in from a desktop browser
// cannot be decoded there, and we say so plainly rather than hanging or storing
// garbage.
export async function compressImage(file: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (isHeic(file)) {
      throw new Error(
        "That photo is in Apple's HEIC format, which this browser can't open. Convert it to a JPEG first — or take the photo from your phone, which sends a JPEG automatically."
      );
    }
    throw new Error("Couldn't read that image — try a JPEG or PNG.");
  }

  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image on this device.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", QUALITY)
  );
  if (!blob) throw new Error("Couldn't process that image.");
  return { bytes: await blob.arrayBuffer(), type: "image/jpeg" };
}

// What the OCR engine should read: the camera's ORIGINAL bytes, not the 0.82
// re-encode above — lossy compression eats exactly the thin thermal strokes
// the reader needs (a field photo read measurably worse re-encoded than raw).
// The one exception is a huge original: past ~4000px the WASM engine's memory
// bill gets dangerous on phones, so downscale gently at high quality. Storage
// still uses compressImage — what you see saved is unchanged.
export const OCR_MAX_DIM = 4000;

// High-quality downscale, no re-encode when already small enough. The OCR
// passes use this twice: once to cap huge originals (WASM memory), and once to
// make a gentler variant — high resolution renders background texture (wood
// grain, patterned borders) as crisp false detail that drowns the reader, so a
// smaller image is sometimes the BETTER read, not the worse one.
export async function scaledJpeg(image: Blob, maxDim: number, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const maxEdge = Math.max(bitmap.width, bitmap.height);
  if (maxEdge <= maxDim) {
    bitmap.close?.();
    return image;
  }
  const scale = maxDim / maxEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return image;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", quality)
  );
  return blob ?? image;
}

export async function imageForOcr(file: File): Promise<Blob> {
  return scaledJpeg(file, OCR_MAX_DIM);
}
