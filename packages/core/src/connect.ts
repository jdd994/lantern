// connect.ts — the shared Connect / Consent / Badge framework.
//
// Every lantern app that talks to an outside institution does it the same way:
// the connection wears an honest badge (the trust ladder), consent is explicit
// and spelled out BEFORE anything is granted (who learns what, what we take,
// what we refuse), and imported records get ids that tell the sync server
// nothing. Hearth's Fitbit connector built the pattern; this file is that
// pattern with the Fitbit taken out, so Ballast's brokerage connectors and
// every future integration inherit it instead of reinventing it.
//
// Three pieces, deliberately small:
//
//   1. The consent contract (`ProviderDescriptor`) — what a consent sheet
//      renders. `refuses` is load-bearing: what we deliberately do NOT take is
//      a promise made in public, and each app's tests assert it's kept.
//   2. OAuth2 + PKCE for public clients (`pkceClient`) — browser ↔ institution
//      directly, no client secret, no backend, nobody new. This is what makes
//      tier 2 honestly tier 2.
//   3. Opaque stable ids (`tagger`) — imported records dedupe on an HMAC of
//      their natural key under a subkey of the vault key, so a re-import lands
//      on the same record on any device while the server learns nothing from
//      the id. Each app pins its `info` string with a golden vector; the string
//      is FROZEN the moment real data exists under it.
//
// No app policy here: the descriptors' words, the scopes, the refusals, and the
// frozen `info` strings all live with the app that owns them.

import { exportKeyRaw } from "./crypto";

// ---- the trust ladder ------------------------------------------------------

// The rungs are shared across the family; each app words its own ladder table.
// 0: nobody learns anything. 1: a provider learns *which* public thing you
// asked about. 2: your browser talks straight to an institution that already
// has the data. 3: a new third party sees plaintext. The number is rendered
// next to the connection forever — it is a property of the data model, not a
// disclosure buried in a policy.
export type Tier = 0 | 1 | 2 | 3;

// What a consent sheet renders, before anyone connects. Write `discloses` as if
// the reader is about to hand you their bank or their body — because they are.
export type ProviderDescriptor = {
  id: string;
  label: string;
  tier: Tier;
  discloses: string;
  takes: string[];
  refuses: string[];
};

// One line of the capability ledger: a capability the user said yes to, wearing
// its honest cost, with enough context to undo it. The card asks BEFORE (the
// ProviderDescriptor above); the ledger answers AFTER — a quiet page the user
// can visit, never a popup.
//
// Entries are DERIVED from what is actually connected — never a separate
// consent log, which could drift from reality and start lying. If it's in the
// ledger it's on; revoking it is the same act as disconnecting it. The revoke
// itself belongs to the app; an entry only describes.
export type ConsentEntry = {
  id: string;
  label: string;
  tier: Tier;
  /** The app's own wording for the rung ("Direct to the brand"). */
  tierLabel?: string;
  discloses: string;
  /** A quiet extra ("3 lights", "last looked 2 hours ago"). */
  detail?: string;
  /** When the user said yes — epoch ms. */
  since?: number;
};

// ---- OAuth2 + PKCE ----------------------------------------------------------
// The dance Hearth's Fitbit connector proved out, provider-agnostic. Public
// client only: if a provider demands a client secret, it cannot use this flow —
// and cannot honestly claim tier 2, because a secret forces a server into the
// middle. That constraint is the point, not a limitation.

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

// Every sentence an OAuth failure can say, overridable so each app keeps its
// own voice. The defaults are calm and true for any provider.
export type OAuthCopy = {
  denied: string; // the user said no on the provider's page — a fine answer
  failed: string; // the provider errored on the way back
  incomplete: string; // returned without the verifier (other tab, cleared session)
  exchangeFailed: string; // the code-for-tokens trade was refused
  signedOut: string; // a refresh was refused; the connection is over
};

export type PkceConfig = {
  clientId: string;
  // The provider's human name ("Fitbit") — used in the default failure copy.
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  // sessionStorage keys become `${storagePrefix}-verifier` / `-state`. Prefix
  // per app+provider ("hearth-fitbit") so two lantern apps on one origin in dev
  // never trample each other's dance.
  storagePrefix: string;
  // Defaults to `${location.origin}/` — register it with the provider.
  redirectUri?: string;
  // Extra provider quirks for the authorize redirect, e.g. { prompt: "login" }.
  authorizeParams?: Record<string, string>;
  copy?: Partial<OAuthCopy>;
};

const DEFAULT_COPY = (label: string): OAuthCopy => ({
  denied: `${label} wasn't connected — nothing was shared, and nothing changed here.`,
  failed: `${label} couldn't complete that connection. You can try again whenever.`,
  incomplete: `That ${label} sign-in didn't finish here. Try connecting again.`,
  exchangeFailed: `${label} wouldn't complete that connection. Try again.`,
  signedOut: `${label} signed this device out. Connect it again when you like.`,
});

const utf8 = (s: string) => new TextEncoder().encode(s);

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const randomB64url = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
}

/** Normalise a token response. Sixty seconds of slack so nothing expires mid-request. */
export function tokensFrom(json: Record<string, unknown>, now: number = Date.now()): OAuthTokens {
  return {
    accessToken: String(json.access_token ?? ""),
    refreshToken: String(json.refresh_token ?? ""),
    expiresAt: now + (Number(json.expires_in ?? 0) - 60) * 1000,
  };
}

export type PkceClient = {
  /** Leave for the provider's consent page. Returns only to say it's about to navigate. */
  beginConnect: () => Promise<void>;
  /** Is this page load our redirect back, carrying a code? Null when it isn't ours. */
  pendingCode: (search?: string) => string | null;
  /** Did we come back having been told no? A calm sentence, or null when it isn't ours. */
  pendingError: (search?: string) => string | null;
  /** Scrub the code from the address bar so a reload can't replay it. */
  clearCallback: () => void;
  /** Trade the code for tokens. No client secret — that's the whole point of PKCE. */
  completeConnect: (code: string) => Promise<OAuthTokens>;
  /** Providers may rotate the refresh token on every use — always store what returns. */
  refreshTokens: (refreshToken: string) => Promise<OAuthTokens>;
  /** The tokens you have, made usable: refreshed only if expired. */
  ensureFresh: (t: OAuthTokens) => Promise<OAuthTokens>;
};

export function pkceClient(cfg: PkceConfig): PkceClient {
  const verifierKey = `${cfg.storagePrefix}-verifier`;
  const stateKey = `${cfg.storagePrefix}-state`;
  const redirectUri = () => cfg.redirectUri ?? `${window.location.origin}/`;
  const copy: OAuthCopy = { ...DEFAULT_COPY(cfg.label), ...cfg.copy };

  async function token(body: Record<string, string>, failure: string): Promise<OAuthTokens> {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
    });
    if (!res.ok) throw new Error(failure);
    return tokensFrom(await res.json());
  }

  return {
    async beginConnect() {
      const verifier = randomB64url(32);
      const state = randomB64url(16);
      // Transient artefacts, parked across the redirect. Not vault secrets — a
      // verifier is useless once the code is spent, and both are gone the
      // moment we're back. They never touch IndexedDB.
      sessionStorage.setItem(verifierKey, verifier);
      sessionStorage.setItem(stateKey, state);
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: "code",
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: "S256",
        scope: cfg.scopes.join(" "),
        redirect_uri: redirectUri(),
        state,
        ...cfg.authorizeParams,
      });
      window.location.assign(`${cfg.authorizeUrl}?${q}`);
    },

    pendingCode(search = window.location.search) {
      const p = new URLSearchParams(search);
      const code = p.get("code");
      const state = p.get("state");
      if (!code || !state) return null;
      // A state we didn't mint means it isn't our redirect. Want no part of it.
      if (state !== sessionStorage.getItem(stateKey)) return null;
      return code;
    },

    pendingError(search = window.location.search) {
      const p = new URLSearchParams(search);
      const err = p.get("error");
      if (!err) return null;
      if (p.get("state") !== sessionStorage.getItem(stateKey)) return null;
      // Saying no is a perfectly good answer, so it gets a calm sentence rather
      // than silence.
      return err === "access_denied" ? copy.denied : copy.failed;
    },

    clearCallback() {
      sessionStorage.removeItem(stateKey);
      sessionStorage.removeItem(verifierKey);
      window.history.replaceState({}, "", window.location.pathname);
    },

    async completeConnect(code) {
      const verifier = sessionStorage.getItem(verifierKey);
      if (!verifier) throw new Error(copy.incomplete);
      const tokens = await token(
        { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() },
        copy.exchangeFailed
      );
      sessionStorage.removeItem(verifierKey);
      return tokens;
    },

    async refreshTokens(refreshToken) {
      return token({ grant_type: "refresh_token", refresh_token: refreshToken }, copy.signedOut);
    },

    async ensureFresh(t) {
      return Date.now() < t.expiresAt ? t : this.refreshTokens(t.refreshToken);
    },
  };
}

// ---- opaque stable ids -------------------------------------------------------
// A re-import must land on the same record, or every refresh duplicates history.
// The obvious id is the natural one ("fitbit:steps:2026-07-16") — and it's a
// metadata leak, because record ids are PLAINTEXT: they're the key the sync
// server stores. That id would tell our own server which provider you use, what
// you track, and on which days. The server is supposed to hold only noise.
//
// So the id is an HMAC of the natural key under a subkey of the vault key:
// deterministic on every one of your devices (dedupe survives sync), opaque to
// everyone without the passphrase.
//
// ⚠️ `info` IS A FROZEN PARAMETER per app. Change it and every id changes, and
// the next import silently duplicates a person's entire history instead of
// updating it. Pin it with a golden vector in the app's tests, next to
// VERIFIER_TEXT and the sharing InviteLabels.

/**
 * Derive the tagging function once, then tag many readings with it. An import
 * mints hundreds of ids; taking the tagger once per import avoids exporting the
 * raw vault key once per reading — wasteful, and needless handling of key
 * material.
 */
export async function tagger(
  dek: CryptoKey,
  info: string
): Promise<(natural: string) => Promise<string>> {
  const raw = new Uint8Array(await exportKeyRaw(dek));
  const hkdf = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    hkdf,
    256
  );
  const mac = await crypto.subtle.importKey(
    "raw",
    bits,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return async (natural: string) => {
    const sig = await crypto.subtle.sign("HMAC", mac, utf8(natural));
    return [...new Uint8Array(sig).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
}

/** One id, for when you only need one (and for the golden vectors). */
export async function stableId(dek: CryptoKey, info: string, natural: string): Promise<string> {
  return (await tagger(dek, info))(natural);
}
