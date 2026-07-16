// api.ts — Hearth's binding to the shared sync-server client (@lantern/core/api).
// Only the base URL is Hearth-specific; the endpoints are the shared ones. It
// moves opaque ciphertext + non-secret metadata only — never the passphrase.
import { createApiClient } from "@lantern/core/api";
import { createSharingClient } from "@lantern/core/sharing-api";

export { ApiError } from "@lantern/core/api";
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

const API_BASE = "https://hearth-server.jdd994.workers.dev";
const client = createApiClient(API_BASE);

export const { register, login, fetchVault, updateVault, deleteAccount, pushChanges, pullChanges } = client;

// Sharing (shared kitchens) speaks the same protocol as its siblings.
export type { SharedRecord, SharedStrandInfo, StrandMember } from "@lantern/core/sharing-api";
export const {
  setIdentity, fetchMe, fetchKeys,
  createShared, inviteToStrand, sharedMembers, sharedMine,
  sharedPush, sharedPull, sharedLeave, sharedRemove,
} = createSharingClient(client.req);
