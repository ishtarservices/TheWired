import { api } from "./client";

export async function subscribePush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  return api<{ success: boolean }>("/push/subscribe", { method: "POST", body: subscription });
}

export async function unsubscribePush(endpoint: string) {
  return api<{ success: boolean }>("/push/subscribe", { method: "DELETE", body: { endpoint } });
}

/**
 * Tell the push pipeline not to push these event ids to our own devices — used
 * for NIP-17 DM self-wraps (messages, edits, deletes, reactions) which are
 * addressed to us and would otherwise buzz our own phone as "new message".
 * Best-effort: a failure only costs a spurious self-notification.
 */
export async function suppressPushForEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  try {
    await api<{ success: boolean }>("/push/suppress", { method: "POST", body: { eventIds } });
  } catch {
    // backend unreachable / not configured (NIP-29-only setups) — ignore
  }
}
