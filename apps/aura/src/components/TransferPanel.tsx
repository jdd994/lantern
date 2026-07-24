// TransferPanel.tsx — move your setup to another device by scanning a code.
// No server, no relay: the whole payload (rooms, scenes, vibes, automations,
// your renamed lights, and — only if you choose — your connected accounts)
// lives in the code itself. The camera only ever opens once you tap Scan, and
// its stream stops the instant a code lands, you cancel, or this unmounts.
//
// Decoding: the native BarcodeDetector is used where present (it's on-device
// ML and cheap), but it's Android/macOS/ChromeOS only — Chrome and Edge on
// Windows don't ship it, which is exactly the "scan on my laptop" case this
// feature exists for. jsQR (pure JS, decodes a canvas snapshot) is the
// fallback so scanning actually works everywhere the camera does.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { decodeTransferQr, encodeTransferQr, isTransferQr } from "../lib/transfer";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
function getBarcodeDetector(): (new (opts: { formats: string[] }) => BarcodeDetectorLike) | null {
  return (
    (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike })
      .BarcodeDetector ?? null
  );
}

type Mode = "idle" | "show" | "scan";

export function TransferPanel({
  onExport,
  onImport,
  onClose,
}: {
  onExport: (includeAccounts: boolean, compact: boolean) => string;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [includeAccounts, setIncludeAccounts] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);

  useEffect(() => {
    if (mode !== "show") return;
    let cancelled = false;
    setTooBig(false);
    setQrDataUrl(null);
    QRCode.toDataURL(encodeTransferQr(onExport(includeAccounts, true)), { margin: 1, width: 260 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTooBig(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, includeAccounts]);

  if (mode === "idle") {
    return (
      <div className="io-row">
        <button className="btn btn-sm" onClick={() => setMode("show")}>
          Show a code
        </button>
        <button className="btn btn-sm" onClick={() => setMode("scan")}>
          Scan a code
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (mode === "show") {
    return (
      <div className="transfer-panel">
        <p className="hint">Open Aura on your other device, tap Scan a code, and point it at this.</p>
        <div className="adaptive-row">
          <span className="hint">Include your connected accounts (Govee, Home Assistant…)</span>
          <button
            className="toggle sm"
            role="switch"
            aria-checked={includeAccounts}
            aria-label="Include connected accounts"
            onClick={() => setIncludeAccounts((v) => !v)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        {includeAccounts && (
          <p className="hint">Only show this to a device you trust — it can control your lights too.</p>
        )}
        {tooBig ? (
          <p className="hint io-note">
            That's too much to fit in one code — try again with accounts off, or use Export/Import below.
          </p>
        ) : qrDataUrl ? (
          <img className="transfer-qr" src={qrDataUrl} alt="Scan this on your other device" width={260} height={260} />
        ) : (
          <p className="hint">Building code…</p>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setMode("idle")}>
          Back
        </button>
      </div>
    );
  }

  return <ScanCode onImport={onImport} onDone={() => setMode("idle")} />;
}

function ScanCode({
  onImport,
  onDone,
}: {
  onImport: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const Detector = getBarcodeDetector();
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    let cancelled = false;
    let raf = 0;
    let scanning = false;

    // A decoded string only counts as a hit if it looks like a setup payload —
    // stops a random QR in the room from being "imported" as garbage.
    async function handleHit(rawValue: string): Promise<boolean> {
      if (!(isTransferQr(rawValue) || rawValue.trim().startsWith("{"))) return false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (cancelled) return true;
      const res = await onImport(decodeTransferQr(rawValue));
      if (cancelled) return true;
      setResult(res.ok ? (res.error ?? "Setup imported.") : (res.error ?? "That code didn't import."));
      return true;
    }

    async function scanFrame() {
      if (cancelled || !videoRef.current) return;
      if (!scanning) {
        scanning = true;
        try {
          if (detector) {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => c.rawValue?.length);
            if (hit && (await handleHit(hit.rawValue))) return;
          } else {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (canvas && video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(frame.data, frame.width, frame.height);
                if (code?.data && (await handleHit(code.data))) return;
              }
            }
          }
        } catch {
          // an undecodable frame isn't an error — just try the next one
        }
        scanning = false;
      }
      raf = requestAnimationFrame(scanFrame);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        raf = requestAnimationFrame(scanFrame);
      })
      .catch(() => setError("Couldn't access the camera — check this site's camera permission."));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onImport]);

  if (result) {
    return (
      <div className="transfer-panel">
        <p className="hint io-note">{result}</p>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="transfer-panel">
      <p className="hint">Point this at the code shown on your other device.</p>
      {error && <p className="hint io-note">{error}</p>}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} className="pairing-scanner" muted playsInline />
      <canvas ref={canvasRef} hidden />
      <button className="btn btn-ghost btn-sm" onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}
