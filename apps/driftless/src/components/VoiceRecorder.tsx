// VoiceRecorder.tsx
// An on-device voice memo recorder. The mic is armed only on an explicit tap
// (never behind the scenes), released the moment recording stops, and the
// captured audio never leaves this component un-encrypted — it hands the
// caller a raw Blob to encrypt and store, the same way a photo file does.

import { useEffect, useRef, useState } from "react";

const MAX_MS = 5 * 60 * 1000; // keep memos light — 5 minutes

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function VoiceRecorder({
  onRecorded,
  onCancel,
}: {
  onRecorded: (blob: Blob, durationMs: number) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"starting" | "recording" | "denied" | "unsupported">("starting");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.start();
        startedAtRef.current = Date.now();
        setStatus("recording");
        timerRef.current = window.setInterval(() => {
          const ms = Date.now() - startedAtRef.current;
          setElapsedMs(ms);
          if (ms >= MAX_MS) stop();
        }, 250);
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    rec.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      onRecorded(blob, durationMs);
    };
    rec.stop();
  }

  function discard() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCancel();
  }

  if (status === "unsupported") {
    return (
      <div className="voice-recorder voice-recorder-note">
        <p>Voice memos aren't supported in this browser — try your keyboard's dictation instead.</p>
        <button className="ghost-btn" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="voice-recorder voice-recorder-note">
        <p>
          Microphone access wasn't granted — you can still write, or use your keyboard's dictation.
        </p>
        <button className="ghost-btn" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      <span className="voice-rec-dot" aria-hidden="true" />
      <span className="voice-rec-time">{formatElapsed(elapsedMs)}</span>
      <button className="save-btn" onClick={stop} disabled={status !== "recording"}>
        Stop
      </button>
      <button className="ghost-btn" onClick={discard}>
        Discard
      </button>
    </div>
  );
}
