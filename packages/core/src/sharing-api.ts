// sharing-api.ts — the client half of the sharing routes (@lantern/server's
// sharing capability). Pure wire calls: every one moves ciphertext + non-secret
// metadata only, never a key or a passphrase.
//
// Extracted from Driftless when Hearth became the second app to speak this
// protocol. There's no policy here and nothing app-shaped — just the endpoints —
// so sharing it is subtraction, not a new abstraction.
//
// Vocabulary: "strand" is Driftless's word, kept because it's the wire format of a
// live deployment (see @lantern/server/sharing). Each app names it in its own
// language at the UI.
import type { CipherBlob, WrappedKey } from "./crypto";
import type { ReqOpts } from "./api";

export type SharedRecord = {
  kind: string; // the app's own record type ("recipe", "mealPlan", "piece"…)
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  dekEpoch: number;
  content: CipherBlob; // encrypted with the collection's key — opaque to the server
};

export type SharedStrandInfo = {
  strandId: string;
  ownerId: string;
  role: string;
  ephemeralPub: string;
  wrappedDEK: WrappedKey; // wrapped to MY identity key; only I can unwrap it
  dekEpoch: number;
};

export type StrandMember = {
  userId: string;
  role: string;
  email: string;
  identityPublicKey: string | null;
};

export type InviteInfo = {
  inviteId: string;
  expiresAt: number;
  revoked: boolean;
  maxUses: number;
  uses: number;
  createdAt: number;
};

type Req = <T = any>(path: string, opts?: ReqOpts) => Promise<T>;

export type SharingClient = ReturnType<typeof createSharingClient>;

/** Build the sharing calls on an existing fetch wrapper (client.req). */
export function createSharingClient(req: Req) {
  return {
    // ---- identity / key directory ----
    /** Set or update this account's identity keypair (migration + rotation). */
    setIdentity: (token: string, identityPublicKey: string, identityPrivWrapped: WrappedKey) =>
      req<{ ok: boolean }>("/identity", {
        method: "POST",
        token,
        body: { identityPublicKey, identityPrivWrapped },
      }),

    /** This account's own user id (authorship of shared records). */
    fetchMe: (token: string) => req<{ userId: string }>("/me", { token }),

    /** Look up one person's public key by an address you already know. */
    fetchKeys: (token: string, email: string) =>
      req<{ identityPublicKey: string | null }>(`/keys?email=${encodeURIComponent(email)}`, { token }),

    // ---- collections + membership ----
    createShared: (token: string, strandId: string, ephemeralPub: string, wrappedDEK: WrappedKey) =>
      req<{ ok: boolean }>("/shared/create", { method: "POST", token, body: { strandId, ephemeralPub, wrappedDEK } }),

    inviteToStrand: (
      token: string,
      strandId: string,
      memberEmail: string,
      ephemeralPub: string,
      wrappedDEK: WrappedKey,
      dekEpoch: number
    ) =>
      req<{ ok: boolean; userId: string }>(`/shared/${strandId}/invite`, {
        method: "POST",
        token,
        body: { memberEmail, ephemeralPub, wrappedDEK, dekEpoch },
      }),

    sharedMembers: (token: string, strandId: string) =>
      req<{ members: StrandMember[] }>(`/shared/${strandId}/members`, { token }),

    sharedMine: (token: string) => req<{ strands: SharedStrandInfo[] }>("/shared/mine", { token }),

    // ---- shared sync ----
    sharedPush: (token: string, strandId: string, changes: SharedRecord[]) =>
      req<{ applied: number; cursor: number }>(`/shared/${strandId}/push`, {
        method: "POST",
        token,
        body: { changes },
      }),

    sharedPull: (token: string, strandId: string, since: number) =>
      req<{ changes: SharedRecord[]; cursor: number; more: boolean }>(
        `/shared/${strandId}/pull?since=${since}`,
        { token }
      ),

    // ---- leaving + removing ----
    sharedLeave: (token: string, strandId: string) =>
      req<{ ok: boolean }>(`/shared/${strandId}/leave`, { method: "POST", token }),

    /** Owner removes a member. Re-keying afterwards is client-driven. */
    sharedRemove: (token: string, strandId: string, userId: string) =>
      req<{ ok: boolean }>(`/shared/${strandId}/remove`, { method: "POST", token, body: { userId } }),

    // ---- invite links ----
    createInviteLink: (
      token: string,
      strandId: string,
      inviteId: string,
      wrappedDEK: CipherBlob,
      joinProofHash: string,
      dekEpoch: number,
      expiresAt: number,
      maxUses: number
    ) =>
      req<{ ok: boolean; inviteId: string }>(`/shared/${strandId}/invite-link`, {
        method: "POST",
        token,
        body: { inviteId, wrappedDEK, joinProofHash, dekEpoch, expiresAt, maxUses },
      }),

    listInvites: (token: string, strandId: string) =>
      req<{ invites: InviteInfo[] }>(`/shared/${strandId}/invites`, { token }),

    revokeInvite: (token: string, strandId: string, inviteId: string) =>
      req<{ ok: boolean }>(`/shared/${strandId}/invites/${inviteId}/revoke`, { method: "POST", token }),

    joinClaim: (token: string, inviteId: string, joinProof: string) =>
      req<{ strandId: string; wrappedDEK: CipherBlob; dekEpoch: number }>("/shared/join/claim", {
        method: "POST",
        token,
        body: { inviteId, joinProof },
      }),

    joinFinish: (
      token: string,
      inviteId: string,
      joinProof: string,
      ephemeralPub: string,
      wrappedDEK: WrappedKey
    ) =>
      req<{ ok: boolean; strandId: string }>("/shared/join/finish", {
        method: "POST",
        token,
        body: { inviteId, joinProof, ephemeralPub, wrappedDEK },
      }),
  };
}
