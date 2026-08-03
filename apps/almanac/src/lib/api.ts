// api.ts — Almanac's binding to the shared sync-server client (@lantern/core/api).
// Only the base URL is Almanac-specific; the endpoints are the shared ones. It
// moves opaque ciphertext + non-secret metadata only — never the passphrase,
// never a date, never a place, never who's going.
import { createApiClient } from "@lantern/core/api";
import { createSharingClient } from "@lantern/core/sharing-api";
import { createRecoveryClient } from "@lantern/core/recovery-api";

export { ApiError } from "@lantern/core/api";
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

// almanac-server isn't deployed yet; the env override keeps local dev honest
// against `wrangler dev` until it is. Same workers.dev pattern as the siblings.
const API_BASE: string = import.meta.env.VITE_ALMANAC_API || "https://almanac-server.jdd994.workers.dev";
const client = createApiClient(API_BASE);

export const { register, login, fetchVault, updateVault, deleteAccount, pushChanges, pullChanges } = client;

// Sharing (a calendar kept together) speaks the same protocol as its siblings'
// shared strands, kitchens, lists, and family trees.
export type { SharedRecord, SharedStrandInfo, StrandMember, InviteInfo } from "@lantern/core/sharing-api";
export const {
  setIdentity, fetchMe, fetchKeys,
  createShared, inviteToStrand, sharedMembers, sharedMine,
  sharedPush, sharedPull, sharedLeave, sharedRemove,
  createInviteLink, listInvites, revokeInvite, joinClaim, joinFinish,
} = createSharingClient(client.req);

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
