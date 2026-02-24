import { api } from "./client";

interface CachedProfile {
  pubkey: string;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  about: string | null;
  nip05: string | null;
  fetchedAt: number;
}

export async function getProfile(pubkey: string) {
  return api<CachedProfile>(`/profiles/${encodeURIComponent(pubkey)}`, { auth: false });
}

export async function batchProfiles(pubkeys: string[]) {
  return api<CachedProfile[]>("/profiles/batch", { method: "POST", body: { pubkeys }, auth: false });
}
