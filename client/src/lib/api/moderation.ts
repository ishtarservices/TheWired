import { api } from "./client";
import type { Ban, Mute } from "../../types/space";

export async function fetchBans(spaceId: string): Promise<Ban[]> {
  const res = await api<Ban[]>(`/spaces/${spaceId}/moderation/bans`);
  return res.data;
}

export async function banMember(
  spaceId: string,
  params: { pubkey: string; reason?: string; expiresAt?: number },
): Promise<Ban> {
  const res = await api<Ban>(`/spaces/${spaceId}/moderation/bans`, {
    method: "POST",
    body: params,
  });
  return res.data;
}

export async function unbanMember(spaceId: string, pubkey: string): Promise<void> {
  await api(`/spaces/${spaceId}/moderation/bans/${pubkey}`, { method: "DELETE" });
}

export async function fetchMutes(spaceId: string): Promise<Mute[]> {
  const res = await api<Mute[]>(`/spaces/${spaceId}/moderation/mutes`);
  return res.data;
}

export async function muteMember(
  spaceId: string,
  params: { pubkey: string; durationSeconds: number; channelId?: string },
): Promise<Mute> {
  const res = await api<Mute>(`/spaces/${spaceId}/moderation/mutes`, {
    method: "POST",
    body: params,
  });
  return res.data;
}

export async function unmuteMember(spaceId: string, muteId: string): Promise<void> {
  await api(`/spaces/${spaceId}/moderation/mutes/${muteId}`, { method: "DELETE" });
}

export async function kickMember(spaceId: string, pubkey: string): Promise<void> {
  await api(`/spaces/${spaceId}/moderation/kick/${pubkey}`, { method: "POST" });
}
