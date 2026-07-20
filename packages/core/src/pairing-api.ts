// pairing-api.ts — the client half of the pairing routes (@lantern/server's
// pairing capability). Mirrors recovery-api.ts's shape. Two of these calls are
// deliberately made with NO token: the new device has no account yet when it
// starts a session or polls for its result — the pairing id (unguessable,
// server-expired in minutes) is the only credential either of them needs.
import type { WrappedBytes } from "./recovery";
import type { ReqOpts } from "./api";

export type PairingStatus = {
  status: "pending" | "delivered" | "cancelled" | "expired";
  wrapped?: WrappedBytes;
};

type Req = <T = any>(path: string, opts?: ReqOpts) => Promise<T>;

export type PairingClient = ReturnType<typeof createPairingClient>;

/** Build the pairing calls on an existing fetch wrapper (client.req). */
export function createPairingClient(req: Req) {
  return {
    // New device: register the session so the scanning device has somewhere
    // to deliver to. No auth — this device has no account yet.
    start: (id: string, publicKeyB64: string) =>
      req<{ ok: boolean; expiresAt: number }>("/pair/start", {
        method: "POST",
        body: { id, publicKeyB64 },
      }),

    // New device: poll until `status` is "delivered" (or it expires/gets cancelled).
    poll: (id: string) => req<PairingStatus>(`/pair/${id}`),

    // Existing, authenticated device, after scanning the QR: hand over the
    // wrapped payload for the server to relay.
    deliver: (token: string, id: string, wrapped: WrappedBytes) =>
      req<{ ok: boolean }>(`/pair/${id}/deliver`, { method: "POST", token, body: { wrapped } }),

    // Existing device: "that wasn't me" — undo a delivery within the TTL.
    cancel: (token: string, id: string) => req<{ ok: boolean }>(`/pair/${id}/cancel`, { method: "POST", token }),
  };
}
