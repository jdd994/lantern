// Wearables.tsx
// Connecting a device you already wear, and the honest cost of doing it.
//
// The consent step is the point, not paperwork. It reuses the same `.trade` box
// the Welcome screen uses to state the no-reset trade up front, and the same
// `.tier-badge` that discloses Open Food Facts in Log food — because this is the
// same promise being kept in a third place, not a new pattern.
//
// Two shapes of provider live here (see `mode` in lib/wearable):
//   grant    connect once, hold a sealed token, refresh history — Fitbit.
//   session  hold nothing: a live sit with a Bluetooth device (strap or ring),
//            where the only thing that ever persists is what you chose to save.
//
// The tone rule from CLAUDE.md holds here too: the badge is honest, not
// frightening. It says what happens, calmly, and lets you decide.

import { useEffect, useRef, useState } from "react";
import {
  PROVIDERS, type ProviderId, type Reading, type WearableConnection,
} from "../lib/wearable";
import * as live from "../lib/wearable/live";

function whenLabel(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConnectWearable({
  provider, onAccept, onClose,
}: {
  provider: ProviderId;
  onAccept: () => void;
  onClose: () => void;
}) {
  const p = PROVIDERS[provider];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Connect {p.label}</h3>

        <div className="trade">
          <strong>Tier {p.tier} — direct.</strong> {p.discloses}
        </div>

        <div className="set-section">
          <div className="set-head">What Hearth takes</div>
          <div className="chips">
            {p.takes.map((t) => <span className="chip" key={t}>{t}</span>)}
          </div>
        </div>

        <div className="set-section">
          <div className="set-head">What Hearth won't take</div>
          {p.refuses.map((r) => <p key={r}>{r}</p>)}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={onAccept}>
            Accept and connect
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- a sit with a live device ------------------------------------------------
// The whole session lives and dies inside this sheet. Closing it stops the
// Bluetooth notifications; there is no token, no connection record, nothing to
// disconnect later. The disclosure is the sheet's first face every time — for a
// session provider the consent and the act are one gesture, not a stored grant.

// Shorter than this isn't resting yet — the first minute is you settling.
// Save unlocks when a summary would be honest.
const MIN_SIT_MS = 60_000;

export function LiveSit({
  provider, onSave, onClose,
}: {
  provider: ProviderId;
  onSave: (readings: Reading[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const p = PROVIDERS[provider];
  const source = live.sources[provider]!;
  const [stage, setStage] = useState<"ask" | "sitting" | "saved">("ask");
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState<live.Sample | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [, setTick] = useState(0); // re-renders the elapsed clock once a second
  const [saved, setSaved] = useState<live.Resting | null>(null);

  const session = useRef<live.Session | null>(null);
  const bpms = useRef<number[]>([]);
  const rrs = useRef<number[]>([]);

  // The sheet unmounting is the session ending, whatever else happens.
  useEffect(() => () => session.current?.stop(), []);
  useEffect(() => {
    if (stage !== "sitting") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  async function begin() {
    setErr(null);
    try {
      const s = await source.open(
        (sample) => {
          // Off-body beats are the device saying "this isn't you" — believed,
          // shown below, and kept out of the summary.
          if (sample.contact !== false && sample.bpm > 0) {
            bpms.current.push(sample.bpm);
            rrs.current.push(...sample.rr);
          }
          setNow(sample);
        },
        () => setErr(`The ${p.label.toLowerCase()} went quiet. What it read so far is still here.`)
      );
      if (!s) return; // the chooser was closed — a complete answer
      session.current = s;
      setName(s.name);
      setStartedAt(Date.now());
      setStage("sitting");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reach the device just now.");
    }
  }

  async function save() {
    const summary = live.resting(bpms.current, rrs.current);
    if (!summary) return;
    session.current?.stop();
    session.current = null;
    try {
      await onSave(live.toReadings(provider, summary, Date.now()));
      setSaved(summary);
      setStage("saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that reading just now.");
    }
  }

  const elapsed = stage === "sitting" ? Date.now() - startedAt : 0;
  const mm = Math.floor(elapsed / 60_000);
  const ss = String(Math.floor((elapsed % 60_000) / 1000)).padStart(2, "0");
  const snapshot = live.resting(bpms.current, rrs.current);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {stage === "ask" ? (
          <>
            <h3>Take a resting reading</h3>
            <div className="trade">
              <strong>Tier {p.tier} — this device only.</strong> {p.discloses}
            </div>
            <div className="set-section">
              <div className="set-head">What Hearth takes</div>
              <div className="chips">
                {p.takes.map((t) => <span className="chip" key={t}>{t}</span>)}
              </div>
            </div>
            <div className="set-section">
              <div className="set-head">What Hearth won't take</div>
              {p.refuses.map((r) => <p key={r}>{r}</p>)}
            </div>
            {err ? <div className="error">{err}</div> : null}
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
              <button type="button" className="btn btn-primary" onClick={() => void begin()}>
                Find my {p.label.toLowerCase()}
              </button>
            </div>
          </>
        ) : stage === "sitting" ? (
          <>
            <h3>{name}</h3>
            <p>Sit comfortably. A couple of quiet minutes makes an honest reading.</p>
            <div className="sit-live">
              <span className="sit-bpm">{now && now.bpm > 0 ? now.bpm : "—"}</span>
              <span className="sit-unit">bpm</span>
            </div>
            <p className="sit-meta">
              {now?.contact === false
                ? source.offBodyHint
                : snapshot && snapshot.samples > 30
                  ? `Mostly ${snapshot.low}–${snapshot.high} · ${mm}:${ss}`
                  : `Listening · ${mm}:${ss}`}
            </p>
            {err ? <div className="error">{err}</div> : null}
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Stop without saving
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={elapsed < MIN_SIT_MS || !snapshot}
                title={elapsed < MIN_SIT_MS ? "A minute of quiet first — settling in isn't resting yet." : undefined}
                onClick={() => void save()}
              >
                Save resting reading
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Saved to Body</h3>
            <p>
              Resting heart rate {saved!.bpm} bpm — it sat mostly between {saved!.low} and{" "}
              {saved!.high}.{" "}
              {saved!.hrv !== null
                ? `Variability ${saved!.hrv} ms, from ${saved!.rrPairs} clean beat-to-beat gaps.`
                : provider === "strap"
                  ? "Too few clean beat-to-beat gaps to say anything true about variability this time."
                  : ""}
            </p>
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Wearables({
  connections, busy, error, canUse, onConnect, onImport, onDisconnect, onSaveReadings,
}: {
  connections: WearableConnection[];
  busy: boolean;
  error: string | null;
  // Whether this build/browser can use a provider at all — an app id for the
  // grant kind, Bluetooth in the browser for the session kind. The hook knows;
  // the component doesn't need to reach into a connector to find out.
  canUse: (p: ProviderId) => boolean;
  onConnect: (p: ProviderId) => void;
  onImport: (p: ProviderId) => void;
  onDisconnect: (p: ProviderId) => void;
  onSaveReadings: (p: ProviderId, readings: Reading[]) => Promise<void> | void;
}) {
  const [asking, setAsking] = useState<ProviderId | null>(null);
  const [sitting, setSitting] = useState<ProviderId | null>(null);
  const ids = Object.keys(PROVIDERS) as ProviderId[];

  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      {ids.map((id) => {
        const p = PROVIDERS[id];

        if (p.mode === "session") {
          return (
            <div className="kitchen-row" key={id}>
              <span>
                {p.label}
                <span className="tier-badge">Tier {p.tier} · this device</span>
              </span>
              <button
                className="btn btn-sm"
                disabled={busy || !canUse(id)}
                title={canUse(id) ? undefined : "This browser can't speak Bluetooth — Chrome and Edge can."}
                onClick={() => setSitting(id)}
              >
                Take a reading
              </button>
            </div>
          );
        }

        const conn = connections.find((c) => c.id === id);
        return (
          <div className="kitchen-row" key={id}>
            <span>
              {p.label}
              <span className="tier-badge">Tier {p.tier} · direct</span>
            </span>
            {conn ? (
              <>
                <span className="metric-row-date">
                  {conn.lastImportAt ? `Last looked ${whenLabel(conn.lastImportAt)}` : "Not looked yet"}
                </span>
                <button className="btn btn-sm" disabled={busy} onClick={() => onImport(id)}>
                  {busy ? "Looking…" : "Refresh"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onDisconnect(id)}>
                  Disconnect
                </button>
              </>
            ) : (
              <button
                className="btn btn-sm"
                disabled={busy || !canUse(id)}
                title={canUse(id) ? undefined : `This build can't connect ${p.label}.`}
                onClick={() => setAsking(id)}
              >
                Connect
              </button>
            )}
          </div>
        );
      })}

      {asking ? (
        <ConnectWearable
          provider={asking}
          onAccept={() => { setAsking(null); onConnect(asking); }}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {sitting ? (
        <LiveSit
          provider={sitting}
          onSave={(readings) => onSaveReadings(sitting, readings)}
          onClose={() => setSitting(null)}
        />
      ) : null}
    </>
  );
}
