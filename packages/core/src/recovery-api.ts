// recovery-api.ts — the client half of the recovery routes (@lantern/server's
// recovery capability). Pure wire calls: every one moves ciphertext + non-secret
// metadata only — never a codeword, a plaintext share, or the DEK. Mirrors
// sharing-api.ts's shape.
import type { CipherBlob } from "./crypto";
import type { GuardianShare, WrappedBytes } from "./recovery";
import type { ReqOpts } from "./api";

export type GuardianEntry = GuardianShare & { email: string; shareIndex: number };

export type RecoveryCircleInfo = {
  k: number;
  n: number;
  delayMs: number;
  guardians: { email: string; shareIndex: number; addedAt: number }[];
};

export type RecoveryStatus = {
  requestId: string;
  status: "collecting" | "pending_delay" | "cancelled" | "completed";
  approvals: number;
  k: number;
  createdAt: number;
  readyAt: number | null;
} | null;

export type PendingForMe = {
  requestId: string;
  ownerEmail: string;
  k: number;
  n: number;
  sessionPub: string;
  myShare: GuardianShare;
};

export type RecoveryRequestPoll = {
  status: "collecting" | "pending_delay" | "cancelled" | "completed";
  approvals: number;
  k: number;
  readyAt: number | null;
  recoveryWrappedDEK?: CipherBlob | null;
  approvalShares?: WrappedBytes[];
};

type Req = <T = any>(path: string, opts?: ReqOpts) => Promise<T>;

export type RecoveryClient = ReturnType<typeof createRecoveryClient>;

/** Build the recovery calls on an existing fetch wrapper (client.req). */
export function createRecoveryClient(req: Req) {
  return {
    // ---- circle setup / rotation ----
    setCircle: (token: string, k: number, n: number, delayMs: number, recoveryWrappedDEK: CipherBlob, guardians: GuardianEntry[]) =>
      req<{ ok: boolean }>("/recovery/circle", {
        method: "POST",
        token,
        body: { k, n, delayMs, recoveryWrappedDEK, guardians },
      }),

    fetchCircle: (token: string) => req<RecoveryCircleInfo>("/recovery/circle", { token }),

    // ---- starting / watching a request (requester side) ----
    startRequest: (token: string, sessionPub: string) =>
      req<{ requestId: string; k: number; n: number; delayMs: number; guardianEmails: string[] }>("/recovery/request", {
        method: "POST",
        token,
        body: { sessionPub },
      }),

    fetchStatus: (token: string) => req<{ request: RecoveryStatus }>("/recovery/status", { token }),

    fetchRequest: (token: string, requestId: string) =>
      req<RecoveryRequestPoll>(`/recovery/${requestId}`, { token }),

    cancelRequest: (token: string, requestId: string) =>
      req<{ ok: boolean }>(`/recovery/${requestId}/cancel`, { method: "POST", token }),

    completeRequest: (token: string, requestId: string) =>
      req<{ ok: boolean }>(`/recovery/${requestId}/complete`, { method: "POST", token }),

    // ---- approving (guardian side) ----
    fetchPendingForMe: (token: string) => req<{ requests: PendingForMe[] }>("/recovery/pending-for-me", { token }),

    approve: (token: string, requestId: string, wrappedShareForRequester: WrappedBytes) =>
      req<{ ok: boolean; approvals: number; ready: boolean }>(`/recovery/${requestId}/approve`, {
        method: "POST",
        token,
        body: { wrappedShareForRequester },
      }),
  };
}
