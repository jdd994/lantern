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

import {
  tagger as coreTagger,
  stableId as coreStableId,
  type ProviderDescriptor,
  type Tier,
} from "@lantern/core/connect";
import type { MetricContent, MetricKind } from "../metrics";
import type { FitbitTokens } from "./fitbit";

export type { Tier };
export type ProviderId = "fitbit";

// The shared consent contract (@lantern/core/connect), with the id narrowed to
// the providers Hearth actually ships. `discloses` is who learns precisely what,
// shown before anyone connects — written as if the reader is about to hand you
// their body, because they are. `takes`/`refuses` both render in the consent
// sheet, so the refusals are a promise made in public rather than a comment in
// a file.
export type Provider = ProviderDescriptor & { id: ProviderId };

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

/**
 * Derive the tagging function once, then tag many readings with it — the shared
 * derivation lives in @lantern/core/connect; this binds Hearth's frozen info
 * string. (Its golden vector is asserted twice: here in fitbit.test.ts and in
 * core's own connect.test.ts, so neither side can drift alone.)
 */
export async function tagger(dek: CryptoKey): Promise<(natural: string) => Promise<string>> {
  return coreTagger(dek, ID_INFO);
}

/** One id, for when you only need one (and for the golden vector). */
export async function stableId(dek: CryptoKey, natural: string): Promise<string> {
  return coreStableId(dek, ID_INFO, natural);
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
