/**
 * Expo Push Service client — plain HTTP, no SDK. Expo's service forwards to
 * APNs/FCM with credentials EAS holds; the backend only needs an optional
 * access token ("enhanced push security" on the Expo project).
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *  - POST /--/api/v2/push/send        ≤100 messages, tickets back
 *  - POST /--/api/v2/push/getReceipts ≤1000 ticket ids, receipts back
 *
 * A `DeviceNotRegistered` ticket OR receipt means the token is dead and the
 * caller must delete it — Expo throttles senders that keep pushing to dead
 * tokens.
 */

import { config } from "../config.js";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_SEND_CHUNK = 100;
export const EXPO_RECEIPT_CHUNK = 1000;

export type ExpoChannel = "default" | "dms" | "activity" | "spaces" | "releases";

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
  ttl?: number;
  channelId?: ExpoChannel;
  /** iOS: let a Notification Service Extension rewrite the content. */
  mutableContent?: boolean;
  /** Notification category (interactive actions / NSE routing). */
  categoryId?: string;
  subtitle?: string;
}

export interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
  };
  if (config.expoAccessToken) h.authorization = `Bearer ${config.expoAccessToken}`;
  return h;
}

export interface ExpoSender {
  /** Tickets come back in message order. Transport errors reject. */
  send(messages: ExpoPushMessage[]): Promise<ExpoTicket[]>;
  /** ticket id → receipt (missing = not ready yet). */
  receipts(ids: string[]): Promise<Record<string, ExpoReceipt>>;
}

export function createExpoSender(fetchImpl: typeof fetch = fetch): ExpoSender {
  return {
    async send(messages) {
      const tickets: ExpoTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_SEND_CHUNK) {
        const chunk = messages.slice(i, i + EXPO_SEND_CHUNK);
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error(`expo push ${res.status}`);
        const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown[] };
        if (!Array.isArray(json.data) || json.data.length !== chunk.length) {
          throw new Error("expo push: malformed ticket response");
        }
        tickets.push(...json.data);
      }
      return tickets;
    },

    async receipts(ids) {
      const out: Record<string, ExpoReceipt> = {};
      for (let i = 0; i < ids.length; i += EXPO_RECEIPT_CHUNK) {
        const chunk = ids.slice(i, i + EXPO_RECEIPT_CHUNK);
        const res = await fetchImpl(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ ids: chunk }),
        });
        if (!res.ok) throw new Error(`expo receipts ${res.status}`);
        const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
        Object.assign(out, json.data ?? {});
      }
      return out;
    },
  };
}
