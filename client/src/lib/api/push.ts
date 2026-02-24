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
