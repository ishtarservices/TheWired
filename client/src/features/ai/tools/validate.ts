/**
 * Validation/coercion for model-supplied tool arguments. The model controls
 * these strings, so everything is decoded, length-capped, and resolved against
 * live app state — never trusted as-is (master plan §10.2). Relays are NEVER
 * taken from the model; write tools resolve targets app-side.
 */
import { nip19 } from "nostr-tools";
import { profileCache } from "@/lib/nostr/profileCache";
import { store } from "@/store";

const MAX_CONTENT = 8000;
const MAX_TITLE = 200;

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function clampContent(value: unknown, max = MAX_CONTENT): string {
  return asString(value).slice(0, max);
}

export function clampTitle(value: unknown): string {
  return asString(value).trim().slice(0, MAX_TITLE);
}

/** Decode an npub/hex to a 64-char hex pubkey, or null. */
export function toHexPubkey(input: unknown): string | null {
  const s = asString(input).trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  try {
    const decoded = nip19.decode(s);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
  } catch {
    /* not bech32 */
  }
  return null;
}

/**
 * Resolve a recipient the model named — by npub/hex first, then by display
 * name/nip05 against the user's OWN contacts (so the model can't DM arbitrary
 * strangers by guessing names; unknowns must be explicit keys). Returns the hex
 * pubkey + a display label, or null.
 */
export function resolveRecipient(
  input: unknown,
): { pubkey: string; label: string } | null {
  const hex = toHexPubkey(input);
  if (hex) {
    const p = profileCache.getCached(hex);
    return { pubkey: hex, label: p?.display_name || p?.name || `@${hex.slice(0, 8)}` };
  }
  const query = asString(input).trim().toLowerCase();
  if (query.length < 2) return null;
  const state = store.getState();
  const contacts = new Set<string>(state.dm.contacts.map((c) => c.pubkey));
  for (const r of state.friendRequests.requests) {
    if (r.status === "accepted") contacts.add(r.pubkey);
  }
  for (const pubkey of contacts) {
    const p = profileCache.getCached(pubkey);
    const name = (p?.display_name || p?.name || "").toLowerCase();
    const nip05 = (p?.nip05 || "").toLowerCase();
    if (name.includes(query) || nip05.includes(query)) {
      return { pubkey, label: p?.display_name || p?.name || `@${pubkey.slice(0, 8)}` };
    }
  }
  return null;
}
