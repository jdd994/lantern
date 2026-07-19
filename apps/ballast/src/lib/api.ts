// api.ts — Ballast's binding to the shared sync-server client (@lantern/core/api).
// Only the base URL is Ballast-specific; the endpoints are the shared ones. It
// moves opaque ciphertext + non-secret metadata only — never the passphrase.
import { createApiClient } from "@lantern/core/api";
import { createSharingClient } from "@lantern/core/sharing-api";
import { createRecoveryClient } from "@lantern/core/recovery-api";

export { ApiError } from "@lantern/core/api";
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

const API_BASE = "https://ballast-server.jdd994.workers.dev";
const client = createApiClient(API_BASE);

export const { register, login, fetchVault, updateVault, deleteAccount, pushChanges, pullChanges } = client;

// Ballast doesn't turn on family-strand sharing (`sharing: true`) — it's a
// single-owner-feeling app on purpose. But /identity + /keys are always
// mounted server-side (see @lantern/server/identity.ts), independent of that
// flag, so guardian lookups still work. Only pull the identity methods out of
// the shared sharing client; the rest (createShared, invite, …) would 404.
export const { setIdentity, fetchKeys } = createSharingClient(client.req);

// Social recovery speaks its own small protocol, same shared-wrapper pattern.
export type {
  GuardianEntry, RecoveryCircleInfo, RecoveryStatus, PendingForMe, RecoveryRequestPoll,
} from "@lantern/core/recovery-api";
export const {
  setCircle, fetchCircle,
  startRequest, fetchStatus: fetchRecoveryStatus, fetchRequest: fetchRecoveryRequest,
  cancelRequest: cancelRecoveryRequest, completeRequest: completeRecoveryRequest,
  fetchPendingForMe, approve: approveRecovery,
} = createRecoveryClient(client.req);
