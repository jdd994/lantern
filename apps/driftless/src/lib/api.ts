// api.ts — Driftless's binding to the shared clients: sync (@lantern/core/api) and
// sharing (@lantern/core/sharing-api). What's left below is genuinely Driftless's
// own: media (R2 blobs) and the feedback box. Moves ciphertext + non-secret
// metadata only.
import { createApiClient, ApiError } from "@lantern/core/api";
import { createSharingClient } from "@lantern/core/sharing-api";
import { createRecoveryClient } from "@lantern/core/recovery-api";

export { ApiError };
export type { VaultMetaDTO } from "@lantern/core/api";
export type { SyncRecord } from "@lantern/core/sync";

// The sync server. (Swap for a custom domain later; also update connect-src in
// public/_headers if this origin changes.)
export const API_BASE = "https://driftless-server.jdd994.workers.dev";

const client = createApiClient(API_BASE);
// The Driftless-specific JSON endpoints below reuse the shared wrapper.
const req = client.req;

export const { register, login, fetchVault, updateVault, deleteAccount, pushChanges, pullChanges } = client;

// Sharing speaks the shared protocol (@lantern/core/sharing-api) — same names the
// app has always imported, so nothing above this line had to change.
export type {
  SharedRecord, SharedStrandInfo, StrandMember, InviteInfo,
} from "@lantern/core/sharing-api";
export const {
  setIdentity, fetchMe, fetchKeys,
  createShared, inviteToStrand, sharedMembers, sharedMine,
  sharedPush, sharedPull, sharedLeave, sharedRemove,
  createInviteLink, listInvites, revokeInvite, joinClaim, joinFinish,
} = createSharingClient(req);

// Social recovery speaks its own small protocol (@lantern/core/recovery-api),
// same shared-wrapper pattern as sharing above.
export type {
  GuardianEntry, RecoveryCircleInfo, RecoveryStatus, PendingForMe, RecoveryRequestPoll,
} from "@lantern/core/recovery-api";
export const {
  setCircle, fetchCircle,
  startRequest, fetchStatus: fetchRecoveryStatus, fetchRequest: fetchRecoveryRequest,
  cancelRequest, completeRequest,
  fetchPendingForMe, approve: approveRecovery,
} = createRecoveryClient(req);

// ---- media (M1: encrypted photo blobs over R2) ----
// Binary, not JSON. The object is iv(12) || ciphertext — already encrypted on
// the device; the server just stores/returns it. Type is non-secret metadata.

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

// Remove a personal photo blob from storage (M3). Best-effort, idempotent.
export async function deleteMediaRemote(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/media/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new ApiError(`Media delete failed (${res.status})`, res.status);
}

// Shared-strand photos (M2): encrypted with the strand DEK, gated by membership.
export async function uploadSharedMedia(
  token: string,
  strandId: string,
  id: string,
  iv: Uint8Array,
  data: ArrayBuffer,
  type: string
): Promise<void> {
  const body = new Uint8Array(iv.byteLength + data.byteLength);
  body.set(iv, 0);
  body.set(new Uint8Array(data), iv.byteLength);
  const res = await fetch(`${API_BASE}/shared/${strandId}/media/${id}?type=${encodeURIComponent(type)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new ApiError(`Media upload failed (${res.status})`, res.status);
}

export async function deleteSharedMediaRemote(token: string, strandId: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/shared/${strandId}/media/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new ApiError(`Media delete failed (${res.status})`, res.status);
}

export async function downloadSharedMedia(
  token: string,
  strandId: string,
  id: string
): Promise<{ iv: Uint8Array; data: ArrayBuffer; type: string } | null> {
  const res = await fetch(`${API_BASE}/shared/${strandId}/media/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`Media download failed (${res.status})`, res.status);
  const all = new Uint8Array(await res.arrayBuffer());
  return {
    iv: all.slice(0, 12),
    data: all.slice(12).buffer,
    type: res.headers.get("content-type") || "application/octet-stream",
  };
}

// ---- feedback (a calm note to the maker) ----

// Open endpoint — no account needed. Token is sent if present, only so a note
// can be attributed; it's never required.
export function sendFeedback(
  message: string,
  contact?: string,
  token?: string | null
): Promise<{ ok: boolean }> {
  return req("/feedback", { method: "POST", token: token ?? undefined, body: { message, contact } });
}

// ---- shared strands (S3) ----
