// ScanCamera.tsx
// The live scan assist: a camera view with the receipt outlined and one calm
// hint about the framing, so the feedback arrives BEFORE the shutter instead
// of after the OCR.
//
// The terms this feature was granted the camera under (see public/_headers,
// and hold them as invariants):
//   - Opens ONLY from an explicit tap. Never automatically.
//   - Frames are read into memory, assessed (lib/scanassist.ts), and
//     discarded. Nothing is stored until the shutter is pressed; nothing ever
//     leaves the device — connect-src would refuse it regardless.
//   - The stream stops the moment this sheet closes, whatever the path out:
//     capture, cancel, backdrop tap, unmount. Camera light off means off.
//   - Declining the browser permission is a fine answer: the caller falls
//     back to the photo picker, which works exactly as it always has.

import { useEffect, useRef, useState } from "react";
import { assess, HINT_COPY, type Hint, type Region } from "../lib/scanassist";

const THUMB_W = 96; // detector thumbnail width — small on purpose
const TICK_MS = 180;
// Steadiness, so the assist reads as a companion rather than a twitch:
// the outline GLIDES toward each new reading instead of jumping to it, and a
// hint must hold its opinion for a few ticks before it may replace the current
// one — hand jitter changes the assessment faster than a human can act on it,
// and relaying every flicker is noise wearing the costume of honesty.
const REGION_GLIDE = 0.35; // 0..1 — how far toward the new box per tick
const REGION_PATIENCE = 5; // ticks without a region before the box fades
const HINT_PATIENCE = 3; // ticks a new hint must persist before it's shown

export function ScanCamera({
  onCapture,
  onClose,
  onUnavailable,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  // Called instead of onClose when the camera can't start (denied, missing) —
  // the caller opens the photo picker path with a calm sentence.
  onUnavailable: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hint, setHint] = useState<Hint>("searching");
  const [ready, setReady] = useState(false);
  const smoothRef = useRef<Region | null>(null);
  const missesRef = useRef(0);
  const hintRef = useRef<{ shown: Hint; candidate: Hint; ticks: number }>({
    shown: "searching",
    candidate: "searching",
    ticks: 0,
  });

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const thumb = document.createElement("canvas");
    const thumbCtx = thumb.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 2560 } },
          audio: false,
        });
        if (!live) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        timer = window.setInterval(() => {
          const v = videoRef.current;
          const overlay = overlayRef.current;
          if (!v || !overlay || !thumbCtx || v.videoWidth === 0) return;

          // Assess a small thumbnail — cheap enough for video rate.
          const tw = THUMB_W;
          const th = Math.round((v.videoHeight / v.videoWidth) * tw);
          thumb.width = tw;
          thumb.height = th;
          thumbCtx.drawImage(v, 0, 0, tw, th);
          const a = assess({ width: tw, height: th, data: thumbCtx.getImageData(0, 0, tw, th).data });

          // Hint hysteresis: a new opinion must persist before it's voiced.
          const hs = hintRef.current;
          if (a.hint === hs.shown) {
            hs.candidate = a.hint;
            hs.ticks = 0;
          } else if (a.hint === hs.candidate) {
            hs.ticks += 1;
            if (hs.ticks >= HINT_PATIENCE) {
              hs.shown = a.hint;
              hs.ticks = 0;
              setHint(a.hint);
            }
          } else {
            hs.candidate = a.hint;
            hs.ticks = 1;
          }

          // Region smoothing: glide toward the new box; tolerate brief misses.
          if (a.region) {
            const prev = smoothRef.current;
            smoothRef.current = prev
              ? {
                  x: prev.x + (a.region.x - prev.x) * REGION_GLIDE,
                  y: prev.y + (a.region.y - prev.y) * REGION_GLIDE,
                  w: prev.w + (a.region.w - prev.w) * REGION_GLIDE,
                  h: prev.h + (a.region.h - prev.h) * REGION_GLIDE,
                }
              : a.region;
            missesRef.current = 0;
          } else {
            missesRef.current += 1;
            if (missesRef.current >= REGION_PATIENCE) smoothRef.current = null;
          }

          // Draw the outline over the live view — mapped onto the area the
          // video actually occupies. object-fit: contain letterboxes the feed,
          // and drawing frame-fractions across the whole overlay stretches the
          // box past the receipt (to the top of the phone, on a tall screen).
          // The overlay must tell the same truth the pixels do.
          overlay.width = overlay.clientWidth;
          overlay.height = overlay.clientHeight;
          const ctx = overlay.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          const r = smoothRef.current;
          if (r) {
            const fit = Math.min(overlay.width / v.videoWidth, overlay.height / v.videoHeight);
            const dw = v.videoWidth * fit;
            const dh = v.videoHeight * fit;
            const dx = (overlay.width - dw) / 2;
            const dy = (overlay.height - dh) / 2;
            ctx.strokeStyle =
              hs.shown === "good" ? "rgba(143,191,163,0.95)" : "rgba(201,169,97,0.9)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
              ctx.roundRect(dx + r.x * dw, dy + r.y * dh, r.w * dw, r.h * dh, 10);
            } else {
              ctx.rect(dx + r.x * dw, dy + r.y * dh, r.w * dw, r.h * dh);
            }
            ctx.stroke();
          }
        }, TICK_MS);
      } catch {
        if (live) {
          stop();
          onUnavailable("No camera this time — picking a photo works just as well.");
        }
      }
    }

    function stop() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (timer !== undefined) window.clearInterval(timer);
    }

    void start();
    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function snap() {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], "receipt-scan.jpg", { type: "image/jpeg" }));
        // The effect cleanup stops the stream when the caller unmounts us —
        // and it will, because a capture closes the sheet.
      },
      "image/jpeg",
      0.95
    );
  }

  return (
    <div className="scan-backdrop" onClick={onClose}>
      <div className="scan-stage" onClick={(e) => e.stopPropagation()}>
        {/* playsInline: iOS otherwise hijacks the stream into fullscreen */}
        <video ref={videoRef} playsInline muted className="scan-video" />
        <canvas ref={overlayRef} className="scan-overlay" aria-hidden="true" />
        <div className="scan-hint" role="status">
          {ready ? HINT_COPY[hint] : "Starting the camera…"}
        </div>
        <div className="scan-controls">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="scan-shutter"
            onClick={snap}
            disabled={!ready}
            aria-label="Take the photo"
          />
          {/* Symmetry spacer so the shutter sits centred */}
          <span className="scan-spacer" aria-hidden="true" />
        </div>
        <p className="scan-terms">
          Live view stays on this device — frames are read in memory and thrown away. Nothing is
          saved until you snap.
        </p>
      </div>
    </div>
  );
}
