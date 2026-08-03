// api.ts — Grove's binding to the shared sync-server client (@lantern/core/api).
// Only the base URL is Grove-specific; the endpoints are the shared ones. It
// moves opaque ciphertext + non-secret metadata only — never the passphrase,
// never a name, never a date.
import { createApiClient, ApiError } from "@lantern/core/api";
import { createSharingClient } from "@lantern/core/sharing-api";
import { createRecoveryClient } from "@lantern/core/recovery-api";

export { ApiError } from "@lantern/core/api";
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

// grove-server isn't deployed yet; the env override keeps local dev honest
// against `wrangler dev` until it is. Same workers.dev pattern as the siblings.
const API_BASE: string = import.meta.env.VITE_GROVE_API || "https://grove-server.jdd994.workers.dev";
const client = createApiClient(API_BASE);

export const { register, login, fetchVault, updateVault, updateRecoveryKit, deleteAccount, pushChanges, pullChanges } = client;

// Sharing (the family's co-authored tree) speaks the same protocol as its
// siblings' shared strands and kitchens.
export type { SharedRecord, SharedStrandInfo, StrandMember } from "@lantern/core/sharing-api";
export const {
  setIdentity, fetchMe, fetchKeys,
  createShared, inviteToStrand, sharedMembers, sharedMine,
  sharedPush, sharedPull, sharedLeave, sharedRemove,
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

// ---- Media (keepsake scans) — same wire format as Driftless's polaroids: ----
// the body is iv(12) || ciphertext, type rides as non-secret metadata.

export async function uploadMedia(
  token: string,
  id: string,
  iv: Uint8Array,
  data: ArrayBuffer,
  type: string
): Promise<void> {
  const body = new Uint8Array(iv.byteLength + data.byteLength);
  body.set(iv, 0);
  body.set(new Uint8Array(data), iv.byteLength);
  const res = await fetch(`${API_BASE}/media/${id}?type=${encodeURIComponent(type)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new ApiError(`Media upload failed (${res.status})`, res.status);
}

export async function downloadMedia(
  token: string,
  id: string
): Promise<{ iv: Uint8Array; data: ArrayBuffer; type: string } | null> {
  const res = await fetch(`${API_BASE}/media/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`Media download failed (${res.status})`, res.status);
  const all = new Uint8Array(await res.arrayBuffer());
  return {
    iv: all.slice(0, 12),
    data: all.slice(12).buffer,
    type: res.headers.get("content-type") || "application/octet-stream",
  };
}

// Remove a scan from storage. Best-effort, idempotent.
export async function deleteMediaRemote(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/media/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new ApiError(`Media delete failed (${res.status})`, res.status);
}
