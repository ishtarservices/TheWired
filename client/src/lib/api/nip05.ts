import { api } from "./client";

/** Check if a username is available for NIP-05 registration */
export async function checkNip05Username(username: string) {
  return api<{ available: boolean; reason?: string }>(
    `/nip05/check/${encodeURIComponent(username.toLowerCase())}`,
  );
}

/** Register a NIP-05 username for the authenticated user */
export async function registerNip05(username: string) {
  return api<{ username: string; nip05: string }>("/nip05/register", {
    method: "POST",
    body: { username },
  });
}

/** Get the authenticated user's current NIP-05 identity */
export async function getMyNip05() {
  return api<{ username: string; nip05: string } | null>("/nip05/me");
}
