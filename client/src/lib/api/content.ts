import { api } from "./client";

export async function pinMessage(spaceId: string, channelId: string, eventId: string) {
  return api<{ success: boolean }>(`/content/spaces/${encodeURIComponent(spaceId)}/pin`, {
    method: "POST",
    body: { eventId, channelId },
  });
}

export async function scheduleMessage(
  spaceId: string,
  params: { content: string; channelId: string; scheduledAt: number; kind?: number },
) {
  return api<{ success: boolean }>(`/content/spaces/${encodeURIComponent(spaceId)}/schedule`, {
    method: "POST",
    body: params,
  });
}
