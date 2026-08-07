// sources/gemini.ts
// Tier 2 — your browser talks straight to Gemini, with no server in the middle.
//
// RE-PROBED 2026-08-04 (same discipline as Alpaca: don't re-litigate from docs,
// re-probe): Gemini echoes the calling origin in `access-control-allow-origin`
// and allowlists its own HMAC headers (`X-GEMINI-APIKEY`, `X-GEMINI-PAYLOAD`,
// `X-GEMINI-SIGNATURE`) on preflight, so the browser can call it directly.
// That keeps this on the same rung as Alpaca: the institution that already
// holds your money learns nothing new, and nobody else learns anything.
//
// THE KEY IS THE USER'S, AND IT NEVER LEAVES THE VAULT UNENCRYPTED. Key and
// secret live inside the account's SourceRef, sealed like all account content.
// They go to exactly one place: api.gemini.com, over TLS. The CSP allowlist
// makes "exactly one place" a browser-enforced fact.
//
// WHAT WE ASK OF GEMINI IS ONE TOTAL. The only endpoint in this file is the
// notional-balances read — Gemini's answer to "what is each balance worth in
// dollars". The reply necessarily itemises per currency (that is the shape of
// the API), but Ballast keeps only the sum; the per-coin breakdown is read,
// added up, and dropped. No orders, no withdrawals — this file contains no way
// to move money, and gemini.test.ts asserts the only path ever fetched is the
// balance read. Ask the user for an Auditor (read-only) key anyway — defence
// in depth; the promise is kept by what we ask for.

import { add, zero, parseMoney, type Money } from "../money";
import type { SnapshotContent, SourceRef } from "../ledger";
import type { Connector } from "./index";

const BASE = "https://api.gemini.com";
const REQUEST_PATH = "/v1/notionalbalances/usd";

// Gemini's request signing: the JSON payload rides base64 in a header, signed
// with HMAC-SHA384. The nonce must increase per key; milliseconds do that.
async function signedHeaders(apiKey: string, secret: string, nonce: number): Promise<Record<string, string>> {
  const payload = btoa(JSON.stringify({ request: REQUEST_PATH, nonce }));
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-384" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(payload)));
  const sigHex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    "Content-Type": "text/plain",
    "X-GEMINI-APIKEY": apiKey,
    "X-GEMINI-PAYLOAD": payload,
    "X-GEMINI-SIGNATURE": sigHex,
  };
}

export const gemini: Connector = {
  kind: "gemini",
  label: "Gemini exchange",
  tier: 2,

  discloses:
    "Your browser talks straight to Gemini with an API key you create there — nobody new sees anything. Gemini already holds this account; this only reads its value back to you. The key is stored encrypted on this device like everything else, and it is sent to Gemini and nowhere else — the browser itself refuses any other destination.",

  takes: [
    "Your balances by currency, in dollar terms, summed into one number — the sum is kept, the breakdown is dropped",
  ],
  refuses: [
    "Trading and withdrawals — there is no code path that moves money; use an Auditor key and it's doubly true",
    "Storing your per-coin holdings — Ballast keeps the total, not the portfolio",
  ],

  validate(ref: SourceRef): string | null {
    if (ref.kind !== "gemini") return "Wrong source type.";
    if (!ref.apiKey.trim()) return "Paste the API key from Gemini.";
    if (!ref.secret.trim()) return "Paste the API secret that came with the key.";
    return null;
  },

  async read(ref: SourceRef): Promise<SnapshotContent> {
    if (ref.kind !== "gemini") throw new Error("Wrong source type.");
    const res = await fetch(`${BASE}${REQUEST_PATH}`, {
      method: "POST",
      headers: await signedHeaders(ref.apiKey.trim(), ref.secret.trim(), Date.now()),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Gemini didn't accept that key. Check it wasn't revoked — you can make a fresh Auditor (read-only) key in Gemini's API settings."
      );
    }
    if (!res.ok) throw new Error("Couldn't reach Gemini just now. Your account is unchanged.");

    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new Error("Gemini sent back something unexpected. Try again shortly.");
    }
    // Sum the dollar value of every balance, exactly — integer minor units,
    // never a float. A row we can't parse makes the whole read unknown: an
    // unknown is not a zero, and a silently short total is the worst kind of
    // plausible.
    let total: Money = zero("USD");
    for (const row of json as Array<{ amountNotional?: unknown }>) {
      const value = typeof row.amountNotional === "string" ? parseMoney(row.amountNotional, "USD") : null;
      if (!value) {
        throw new Error("Gemini sent back something unexpected. Try again shortly.");
      }
      total = add(total, value);
    }
    return { type: "balance", value: total };
  },
};
