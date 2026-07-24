// api.ts — Aura's only network call to anything Lantern owns: the feedback
// box. Everything else in the app talks straight to a light brand's own
// service (or nothing at all). See ../../server for what's on the other end.
import { createApiClient } from "@lantern/core/api";

export const API_BASE = "https://aura-server.jdd994.workers.dev";

const { req } = createApiClient(API_BASE);

export function sendFeedback(message: string, contact?: string): Promise<{ ok: boolean }> {
  return req("/feedback", { method: "POST", body: { message, contact } });
}
