import { api } from "./client";
import type { SpaceChannel, SpaceChannelCategory } from "../../types/space";

export interface ChannelLayoutResponse {
  revision: number;
  categories: SpaceChannelCategory[];
  channels: SpaceChannel[];
}

export interface ChannelLayoutDoc {
  baseRevision: number;
  uncategorized: string[];
  /** Omit `id` to create a category; leaving one out deletes it. */
  categories: Array<{ id?: string; name: string; channelIds: string[] }>;
}

export async function fetchChannels(spaceId: string): Promise<SpaceChannel[]> {
  const res = await api<SpaceChannel[]>(`/spaces/${spaceId}/channels`);
  return res.data;
}

export async function createChannel(
  spaceId: string,
  params: {
    type: string;
    label: string;
    /** A category id (null/absent = none). */
    categoryId?: string | null;
    adminOnly?: boolean;
    slowModeSeconds?: number;
    temporary?: boolean;
    feedMode?: "all" | "curated";
  },
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

/** Categories + channels + revision (404 when the backend predates subfolders). */
export async function fetchLayout(spaceId: string): Promise<ChannelLayoutResponse> {
  const res = await api<ChannelLayoutResponse>(`/spaces/${spaceId}/channels/layout`);
  return res.data;
}

/** Replace the layout; 409 (`LAYOUT_STALE`) when `baseRevision` is behind. */
export async function putLayout(spaceId: string, doc: ChannelLayoutDoc): Promise<ChannelLayoutResponse> {
  const res = await api<ChannelLayoutResponse>(`/spaces/${spaceId}/channels/layout`, {
    method: "PUT",
    body: doc,
  });
  return res.data;
}

/** Make a channel follow its category's permissions again. */
export async function syncChannelPermissions(spaceId: string, channelId: string): Promise<SpaceChannel> {
  const res = await api<SpaceChannel>(`/spaces/${spaceId}/channels/${channelId}/sync-permissions`, {
    method: "POST",
  });
  return res.data;
}
