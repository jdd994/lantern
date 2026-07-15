// api.ts — Ballast's binding to the shared sync-server client (@lantern/core/api).
// Only the base URL is Ballast-specific; the endpoints are the shared ones. It
// moves opaque ciphertext + non-secret metadata only — never the passphrase.
import { createApiClient } from "@lantern/core/api";

export { ApiError } from "@lantern/core/api";
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

const API_BASE = "https://ballast-server.jdd994.workers.dev";
const client = createApiClient(API_BASE);

export const { register, login, fetchVault, updateVault, deleteAccount, pushChanges, pullChanges } = client;
