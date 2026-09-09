// The rules that decide what a people row prints. Pure, ported from the
// mobile PeopleSection.

import type { PersonHit } from "@/lib/api/people";
import type { UserSearchResult } from "@/features/search/useUserSearch";
import { getDisplayName } from "@/features/dm/dmUtils";

/** The app's own nip05 domain. Everyone on it shares the suffix, so printing
 *  it on every row is pure repetition. */
const OWN_NIP05_DOMAIN = "thewired.app";

/**
 * A handle earns its line only when it tells you something the name doesn't.
 * `gothicmonk@thewired.app` under "Gothic Monk" is the same word twice plus a
 * domain every row shares — so it is dropped; in browse the header says the
 * list is verified, in search the domain mark does (see verifierFor). A
 * foreign domain, or a local part that differs from the display name, is real
 * information and stays.
 */
export function handleFor(nip05: string | null, name: string): string | null {
  if (!nip05) return null;
  const at = nip05.lastIndexOf("@");
  if (at < 1) return nip05;
  const local = nip05.slice(0, at);
  const domain = nip05.slice(at + 1).toLowerCase();
  if (domain !== OWN_NIP05_DOMAIN) return nip05;
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  return flat(local) === flat(name) ? null : local;
}

/**
 * On nostr the handle IS the verification — a nip05 is a name that resolves
 * at a domain, nothing more — so the trust mark is the domain, in the mono
 * id voice, never a platform check icon. It only earns its place where it
 * says something: browse is verified-only (the header states it) → never; a
 * handle line that already prints an "@domain" → never. Otherwise the domain
 * is the only thing on the row that vouches for the name.
 */
export function verifierFor(
  nip05: string | null,
  handle: string | null,
  mixed: boolean,
): string | null {
  if (!mixed || !nip05) return null;
  if (handle?.includes("@")) return null;
  const at = nip05.lastIndexOf("@");
  if (at < 1) return null; // "nodomain" / "@thewired.app" — nothing to vouch
  return nip05.slice(at + 1).toLowerCase();
}

/** Activity, or silence. Never "0 notes" — a zero here usually means the
 *  30-day window is empty, not that the person is inactive, and printing it
 *  would state something we cannot actually support. */
export function personSignalLabel(noteCount: number): string | null {
  if (noteCount <= 0) return null;
  return `${noteCount} ${noteCount === 1 ? "note" : "notes"} · 30d`;
}

export interface PersonRowData {
  pubkey: string;
  name: string;
  /** Only when it adds information (handleFor). */
  handle: string | null;
  /** Raw — the verifier lives in its domain. */
  nip05: string | null;
  verified: boolean;
  about: string | null;
  picture: string | null;
  /** 30-day; 0 means "no recent activity", not "unknown". */
  noteCount: number;
}

export function fromHit(hit: PersonHit): PersonRowData {
  const name = hit.displayName ?? hit.name ?? getDisplayName(undefined, hit.pubkey);
  return {
    pubkey: hit.pubkey,
    name,
    handle: handleFor(hit.nip05, name),
    nip05: hit.nip05,
    verified: hit.hasNip05,
    about: hit.about,
    picture: hit.picture,
    noteCount: hit.noteCount,
  };
}

export function fromLocal(result: UserSearchResult): PersonRowData {
  const name = getDisplayName(result.profile, result.pubkey);
  const nip05 = result.profile?.nip05 || null;
  return {
    pubkey: result.pubkey,
    name,
    handle: handleFor(nip05, name),
    nip05,
    verified: !!nip05,
    about: result.profile?.about || null,
    picture: result.profile?.picture || null,
    noteCount: 0,
  };
}
