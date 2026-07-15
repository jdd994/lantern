// api.ts — the shared sync-server client.
//
// createApiClient(baseUrl) returns typed fetch wrappers for the endpoints every
// app's server shares: register / login / fetchVault / updateVault / deleteAccount
// / pushChanges / pullChanges. It only ever moves opaque ciphertext + non-secret
// metadata — never the passphrase or the key. The returned `req` is exposed so an
// app with extra endpoints (Driftless's identity / sharing / media) can build them
// on the same wrapper.

import type { CipherBlob, WrappedKey } from "./crypto";
import type { SyncRecord } from "./sync";

export type { SyncRecord } from "./sync";

// Errors carry the HTTP status so callers can branch on it (e.g. 409 conflicts).
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// The vault metadata a new device needs to re-derive the key. Superset across the
// apps: `currency` (Ballast) and `identityPublicKey` (Driftless) are optional and
// simply absent where an app doesn't use them.
export type VaultMetaDTO = {
  salt: number[];
  verifier: CipherBlob;
  iterations?: number;
  identityPublicKey?: string | null;
  identityPrivWrapped?: WrappedKey | null;
  currency?: string | null;
  wrappedDEK?: CipherBlob | null;
};

export type ReqOpts = { method?: string; token?: string; body?: unknown };

export type ApiClient = {
  baseUrl: string;
  req<T>(path: string, opts?: ReqOpts): Promise<T>;
  register(
    email: string,
    password: string,
    vault: VaultMetaDTO,
    identityPublicKey: string,
    identityPrivWrapped: WrappedKey
  ): Promise<{ token: string; userId: string }>;
  login(email: string, password: string): Promise<{ token: string; userId: string }>;
  fetchVault(token: string): Promise<VaultMetaDTO>;
  updateVault(
    token: string,
    vault: { salt: number[]; verifier: CipherBlob; iterations?: number; wrappedDEK: CipherBlob }
  ): Promise<{ ok: boolean }>;
  deleteAccount(token: string): Promise<{ ok: boolean }>;
  pushChanges(token: string, changes: SyncRecord[]): Promise<{ applied: number; cursor: number }>;
  pullChanges(token: string, since: number): Promise<{ changes: SyncRecord[]; cursor: number; more: boolean }>;
};

export function createApiClient(baseUrl: string): ApiClient {
  async function req<T>(path: string, opts: ReqOpts = {}): Promise<T> {
    const res = await fetch(baseUrl + path, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.body ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status);
    return data as T;
  }

  return {
    baseUrl,
    req,
    register: (email, password, vault, identityPublicKey, identityPrivWrapped) =>
      req("/auth/register", {
        method: "POST",
        body: { email, password, vault, identityPublicKey, identityPrivWrapped },
      }),
    login: (email, password) => req("/auth/login", { method: "POST", body: { email, password } }),
    fetchVault: (token) => req("/vault", { token }),
    updateVault: (token, vault) => req("/vault", { method: "PUT", token, body: vault }),
    deleteAccount: (token) => req("/me", { method: "DELETE", token }),
    pushChanges: (token, changes) => req("/sync/push", { method: "POST", token, body: { changes } }),
    pullChanges: (token, since) => req(`/sync/pull?since=${since}`, { token }),
  };
}
