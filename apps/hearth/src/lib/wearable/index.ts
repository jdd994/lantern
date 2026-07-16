// wearable/index.ts
// Bringing readings in from a device you already wear. Every provider must state
// its rung on the trust ladder, the same way Ballast's connectors do: `tier` is
// not documentation, it's rendered next to the connection, forever. A provider
// that cannot honestly justify its tier does not get merged.
//
// TWO RULES THAT DON'T MOVE, and that shaped this whole module:
//
// 1. WE IMPORT MEASUREMENTS, NEVER SCORES. Fitbit sends a sleep efficiency
//    score. Oura sends readiness. Withings sends BMI. Every one of them is
//    someone else's judgement of your body, delivered as a number out of 100 —
//    which is precisely what Hearth exists to refuse. We take the hours you
//    slept; we drop the grade they gave you for sleeping them. `refuses` below
//    lists what we deliberately throw away, and fitbit.test.ts asserts we
//    actually throw it away.
//
// 2. NO CALORIES BURNED. Fitbit will happily sell us calories-out, and it's the
//    single most requested wearable number. We don't take it, on purpose:
//    calories-out sitting next to Hearth's food log silently adds up to a
//    deficit, and deficit maths is the exact harm the guardrail forbids. There
//    is no toggle for this. It just isn't imported.

import { exportKeyRaw } from "../crypto";
import type { MetricContent, MetricKind } from "../metrics";
import type { FitbitTokens } from "./fitbit";

export type Tier = 0 | 1 | 2 | 3;
export type ProviderId = "fitbit";

export type Provider = {
  id: ProviderId;
  label: string;
  tier: Tier;

  // Precisely who learns precisely what, shown before anyone connects. Write it
  // as if the person reading it is about to hand you their body, because they are.
  discloses: string;

  // What we take, and what we refuse — both rendered in the consent sheet, so the
  // refusals are a promise made in public rather than a comment in a file.
  takes: string[];
  refuses: string[];
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  fitbit: {
    id: "fitbit",
    label: "Fitbit",
    tier: 2,
    discloses:
      "Your browser talks straight to Fitbit — nobody new sees anything. Fitbit already holds " +
      "these readings; this only copies them to you. They learn that an app read your data, " +
      "and Hearth's own server never sees any of it: readings are encrypted here before they're " +
      "stored or synced, like everything else.",
    takes: ["Weight and body fat", "Sleep duration", "Resting heart rate", "Steps"],
    refuses: [
      "Calories burned — it would turn your food log into deficit maths",
      "Sleep scores and BMI — a grade for your body is not a measurement of it",
      "Anything else in your Fitbit account",
    ],
  },
};

// ---- stable ids ----------------------------------------------------------
// A re-import must land on the same record, or every refresh duplicates your
// history. The obvious id is the natural one ("fitbit:steps:2026-07-16") — and
// it's a metadata leak, because record ids are PLAINTEXT: they're the key the
// sync server stores. That id would tell our own server you use Fitbit, that you
// track steps, and on which days. The server is supposed to hold only noise.
//
// So the id is an HMAC of the natural key under a subkey of your vault key. It's
// deterministic (a re-import on ANY of your devices lands on the same record,
// so dedupe survives sync), and it's opaque to everyone without the passphrase.
//
// ⚠️ ID_INFO IS A FROZEN PARAMETER. Change it and every id changes, which means
// the next import silently duplicates a person's entire body history instead of
// updating it. Same discipline as VERIFIER_TEXT and the sharing InviteLabels —
// it's pinned by a golden vector in wearable.test.ts.
const ID_INFO = "hearth-wearable-id-v1";

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Derive the tagging function once, then tag many readings with it. An import
 * mints a few hundred ids, and doing the whole derivation per reading would
 * export the raw vault key a few hundred times — wasteful, and needless handling
 * of key material. Take the tagger once per import; hand it each natural key.
 */
export async function tagger(dek: CryptoKey): Promise<(natural: string) => Promise<string>> {
  const raw = new Uint8Array(await exportKeyRaw(dek));
  const hkdf = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(ID_INFO) },
    hkdf,
    256
  );
  const mac = await crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return async (natural: string) => {
    const sig = await crypto.subtle.sign("HMAC", mac, utf8(natural));
    return [...new Uint8Array(sig).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
}

/** One id, for when you only need one (and for the golden vector). */
export async function stableId(dek: CryptoKey, natural: string): Promise<string> {
  return (await tagger(dek))(natural);
}

// ---- readings ------------------------------------------------------------
// What a provider's mapper produces: a plain measurement, plus the natural key
// it's deduped by. `natural` never reaches storage — only its HMAC does.

export type Reading = {
  kind: MetricKind;
  value: number;
  unit: string;
  at: number;
  natural: string;
};

export function readingContent(r: Reading, provider: ProviderId): MetricContent {
  return { kind: r.kind, value: r.value, unit: r.unit, source: provider };
}

// ---- connections ---------------------------------------------------------
// What a connection stores (encrypted — these tokens can read someone's Fitbit,
// so they're sealed with the vault key like any other secret).
export type ConnectionContent = { tokens: FitbitTokens; lastImportAt?: number };

// What the UI is told about a connection. No tokens: nothing that can read your
// Fitbit ever reaches React state.
export type WearableConnection = { id: ProviderId; connectedAt: number; lastImportAt?: number };
