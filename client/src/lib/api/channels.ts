import { api } from "./client";
import type { SpaceChannel } from "../../types/space";

export async function fetchChannels(spaceId: string): Promise<SpaceChannel[]> {
  const res = await api<SpaceChannel[]>(`/spaces/${spaceId}/channels`);
  return res.data;
}

export async function createChannel(
  spaceId: string,
  params: { type: string; label: string; categoryId?: string; adminOnly?: boolean; slowModeSeconds?: number; feedMode?: "all" | "curated" },
): Promise<SpaceChannel> {
  const res = await api<SpaceChannel>(`/spaces/${spaceId}/channels`, {
    method: "POST",
    body: params,
  });
  return res.data;
}

export async function updateChannel(
  spaceId: string,
  channelId: string,
  params: { label?: string; categoryId?: string | null; position?: number; adminOnly?: boolean; slowModeSeconds?: number; isDefault?: boolean; feedMode?: "all" | "curated" },
): Promise<SpaceChannel> {
  const res = await api<SpaceChannel>(`/spaces/${spaceId}/channels/${channelId}`, {
    method: "PATCH",
    body: params,
  });
  return res.data;
}

export async function deleteChannel(spaceId: string, channelId: string): Promise<void> {
  await api(`/spaces/${spaceId}/channels/${channelId}`, { method: "DELETE" });
}

export async function reorderChannels(spaceId: string, orderedIds: string[]): Promise<void> {
  await api(`/spaces/${spaceId}/channels/reorder`, {
    method: "POST",
    body: { orderedIds },
  });
}
