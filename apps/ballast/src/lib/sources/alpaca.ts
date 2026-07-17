// sources/alpaca.ts
// Tier 2 — your browser talks straight to Alpaca, with no server in the middle.
//
// WHY ALPACA FIRST (probed 2026-07-17, the same discipline as Hearth's wearable
// matrix — don't re-litigate from docs, re-probe): the only thing that decides
// whether a PWA can do this is CORS. Alpaca sends `access-control-allow-origin: *`
// AND allowlists its own auth headers (`Apca-Api-Key-Id`, `Apca-Api-Secret-Key`),
// so the browser can call it directly. Gemini also passes the probe (echoes the
// origin, approves its HMAC headers) and is the natural next connector. Kraken
// and Binance.US send no CORS at all; Bitstamp allows the origin but not its own
// auth headers; Coinbase only permits OAuth Bearer, and its token exchange wants
// a client secret — all of those would force a server that sees balances, which
// is a different (worse) rung, not an implementation detail.
//
// THE KEY IS THE USER'S, AND IT NEVER LEAVES THE VAULT UNENCRYPTED. The key id
// and secret live inside the account's SourceRef, which is sealed like all
// account content. They go to exactly one place: api.alpaca.markets, over TLS,
// as headers on a read. The CSP allowlist makes that "exactly one place" a
// browser-enforced fact.
//
// WHAT WE ASK OF ALPACA IS ONE NUMBER. The only endpoint in this file is the
// account read. No positions, no order history, and above all NO ORDERS — this
// file contains no way to trade, and alpaca.test.ts asserts the only path ever
// fetched is /v2/account. Ask the user for a read-only key anyway (defence in
// depth), but the promise is kept by what we ask for, not by what we're
// permitted — same principle as Hearth refusing Fitbit's calories.

import { parseMoney } from "../money";
import type { SnapshotContent, SourceRef } from "../ledger";
import type { Connector } from "./index";

// Alpaca key ids carry their environment: live keys start "AK", paper keys "PK".
// Detecting it beats asking — a person pasting a paper key shouldn't also have
// to know which base URL their key belongs to.
export const endpoints = {
  live: "https://api.alpaca.markets",
  paper: "https://paper-api.alpaca.markets",
};

export function endpointFor(keyId: string): string {
  return keyId.trim().toUpperCase().startsWith("PK") ? endpoints.paper : endpoints.live;
}

export const alpaca: Connector = {
  kind: "alpaca",
  label: "Alpaca brokerage",
  tier: 2,

  discloses:
    "Your browser talks straight to Alpaca with an API key you create there — nobody new sees anything. Alpaca already holds this account; this only reads its value back to you. The key is stored encrypted on this device like everything else, and it is sent to Alpaca and nowhere else — the browser itself refuses any other destination.",

  takes: ["The account's total value (equity), as one number"],
  refuses: [
    "Trading — there is no code path that places an order; use a read-only key and it's doubly true",
    "Your individual positions and history — Ballast reads the total, not the portfolio",
  ],

  validate(ref: SourceRef): string | null {
    if (ref.kind !== "alpaca") return "Wrong source type.";
    const keyId = ref.keyId.trim();
    const secret = ref.secret.trim();
    if (!keyId) return "Paste the API key ID from Alpaca.";
    if (!secret) return "Paste the API secret that came with the key.";
    if (!/^[AP]K[A-Z0-9]{10,}$/i.test(keyId)) {
      return "That doesn't look like an Alpaca key ID — they start with AK (live) or PK (paper).";
    }
    return null;
  },

  async read(ref: SourceRef): Promise<SnapshotContent> {
    if (ref.kind !== "alpaca") throw new Error("Wrong source type.");
    const res = await fetch(`${endpointFor(ref.keyId)}/v2/account`, {
      headers: {
        "APCA-API-KEY-ID": ref.keyId.trim(),
        "APCA-API-SECRET-KEY": ref.secret.trim(),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Alpaca didn't accept that key. Check it wasn't revoked — you can make a fresh read-only key in the Alpaca dashboard."
      );
    }
    if (!res.ok) throw new Error("Couldn't reach Alpaca just now. Your account is unchanged.");

    const json = (await res.json()) as { equity?: unknown; currency?: unknown };
    const currency = typeof json.currency === "string" && json.currency ? json.currency : "USD";
    // Alpaca sends equity as a decimal string. parseMoney keeps it exact —
    // truncation over rounding, and never a float.
    const value = typeof json.equity === "string" ? parseMoney(json.equity, currency) : null;
    if (!value) {
      throw new Error("Alpaca sent back something unexpected. Try again shortly.");
    }
    return { type: "balance", value };
  },
};
