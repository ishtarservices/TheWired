import type { NostrEvent, UnsignedEvent } from "@/types/nostr";

/**
 * Granting a listen request = the owner republishes the target (same kind and
 * d, fresh created_at) with the requester added as a VIEWER:
 *
 *   ["p", requester, "", "collaborator"]
 *
 * `collaborator` is the role the backend's pTagGrantsAccess honours and the
 * one desktop parsers read as `collaborators`. When the event is desktop's
 * NIP-44-encrypted private form (`["visibility","private"]` + content the
 * owner can decrypt from self, what buildPrivateTrackEvent writes), the
 * grant also appends a per-viewer copy:
 *
 *   ["encrypted_content", nip44Encrypt(requester, plaintext), requester]
 *
 * Private events with empty or cleartext content (soot uploads) need only the
 * p-tag. Everything else is preserved verbatim, in order; the grant only
 * appends. A project's gating is per event (blob/HLS), so the plan also pushes
 * the viewer onto every child track the owner authored.
 */

export interface GrantCrypto {
  /** Decrypt `ciphertext` the owner encrypted to themselves. */
  decryptSelf(ciphertext: string): Promise<string>;
  /** Encrypt `plaintext` for `recipient`. */
  encryptFor(recipient: string, plaintext: string): Promise<string>;
}

/** Roles that unlock protected content — mirror of the backend's
 *  `pTagGrantsAccess` (blobAccess.ts). `featured` is a credit, not a grant;
 *  a role-less p-tag is a legacy grant. */
const ACCESS_ROLES: ReadonlySet<string> = new Set(["artist", "collaborator", "contributor", "editor"]);

export function pTagGrantsAccess(tag: readonly string[], pubkey: string): boolean {
  if (tag[0] !== "p" || tag[1] !== pubkey) return false;
  const role = tag[3];
  return !role || ACCESS_ROLES.has(role);
}

function isPrivateTags(tags: readonly string[][]): boolean {
  return tags.some((t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"));
}

function hasSpaceTags(tags: readonly string[][]): boolean {
  return tags.some((t) => t[0] === "h" && !!t[1]);
}

/** Every `h` value on the event, deduped, in tag order. */
export function spaceIdsOf(event: Pick<NostrEvent, "tags">): string[] {
  return [...new Set(event.tags.filter((t) => t[0] === "h" && t[1]).map((t) => t[1]))];
}

/**
 * Does `content` have the shape of a NIP-44 v2 payload (base64, version byte
 * 0x02, at least the minimum payload length)? Used to tell a failed decrypt of
 * a real ciphertext (abort — granting without the copy would leave the viewer
 * unable to read it) from cleartext content (p-tag only).
 */
export function looksLikeNip44(content: string): boolean {
  if (content.length < 132 || content.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return false;
  try {
    return atob(content.slice(0, 4)).charCodeAt(0) === 2;
  } catch {
    return false;
  }
}

export type AccessState =
  /** No visibility gate, no space: anyone can already play it. */
  | "public"
  /** The requester is the author or already holds what a grant would add. */
  | "has-access"
  /** Space-scoped (`h`): the backend checks membership before p-tags, so a
   *  per-person grant cannot unlock it — they need to join the space. */
  | "space"
  /** Private and the requester lacks a grant (or their decryptable copy). */
  | "needs-grant";

/**
 * Where does `requester` stand against this event? Synchronous: the encrypted
 * form is detected by content shape. Space membership is the caller's to
 * check (it needs member lists).
 */
export function accessStateFor(event: Pick<NostrEvent, "pubkey" | "tags" | "content">, requester: string): AccessState {
  if (requester === event.pubkey) return "has-access";
  if (hasSpaceTags(event.tags)) return "space";
  if (!isPrivateTags(event.tags)) return "public";
  const granted = event.tags.some((t) => pTagGrantsAccess(t, requester));
  if (!granted) return "needs-grant";
  const encrypted = !!event.content && looksLikeNip44(event.content);
  if (encrypted && !event.tags.some((t) => t[0] === "encrypted_content" && t[2] === requester)) {
    return "needs-grant";
  }
  return "has-access";
}

function republishTime(prev: Pick<NostrEvent, "created_at">, now: number): number {
  // A replaceable event only replaces when it's newer.
  return Math.max(now, prev.created_at + 1);
}

/**
 * `prev` with `requester` added as a viewer, or null when nothing would change
 * (author, or already granted with any copy they need). Appends only.
 */
export async function grantViewerOnEvent(
  prev: NostrEvent,
  requester: string,
  crypto: GrantCrypto,
  now: number = Math.floor(Date.now() / 1000),
): Promise<UnsignedEvent | null> {
  if (!requester || requester === prev.pubkey) return null;

  const appended: string[][] = [];
  if (!prev.tags.some((t) => pTagGrantsAccess(t, requester))) {
    appended.push(["p", requester, "", "collaborator"]);
  }

  if (isPrivateTags(prev.tags) && prev.content) {
    const hasCopy = prev.tags.some((t) => t[0] === "encrypted_content" && t[2] === requester);
    if (!hasCopy) {
      let plaintext: string | null = null;
      try {
        plaintext = await crypto.decryptSelf(prev.content);
      } catch (err) {
        if (looksLikeNip44(prev.content)) {
          throw new Error(
            `Couldn't decrypt this private release to share it${err instanceof Error ? ` (${err.message})` : ""}.`,
          );
        }
        // Cleartext content (e.g. a soot description) — the p-tag is enough.
      }
      if (plaintext !== null) {
        appended.push(["encrypted_content", await crypto.encryptFor(requester, plaintext), requester]);
      }
    }
  }

  if (appended.length === 0) return null;
  return {
    pubkey: prev.pubkey,
    created_at: republishTime(prev, now),
    kind: prev.kind,
    tags: [...prev.tags.map((t) => [...t]), ...appended],
    content: prev.content,
  };
}

/** The project's child-track refs the owner authored (`a` tags), deduped, in order. */
export function ownedChildTrackRefs(project: Pick<NostrEvent, "tags" | "pubkey">): string[] {
  const prefix = `31683:${project.pubkey}:`;
  return [...new Set(project.tags.filter((t) => t[0] === "a" && t[1]?.startsWith(prefix)).map((t) => t[1]))];
}

function addressOf(event: Pick<NostrEvent, "kind" | "pubkey" | "tags">): string {
  return `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
}

/**
 * Everything the owner republishes to grant one listener: the target and, for
 * a project, each owned child track that lacks the viewer. Empty when nothing
 * needs changing (the caller then just resolves the request).
 *
 * `childTracks` holds the latest known event per child ref; refs with no known
 * event are skipped (the caller reports them).
 */
export async function planGrant(params: {
  target: NostrEvent;
  requester: string;
  me: string;
  childTracks?: readonly NostrEvent[];
  crypto: GrantCrypto;
  now?: number;
}): Promise<UnsignedEvent[]> {
  const { target, requester, me, crypto } = params;
  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (target.pubkey !== me) throw new Error("Only the owner can grant access.");

  const out: UnsignedEvent[] = [];
  const head = await grantViewerOnEvent(target, requester, crypto, now);
  if (head) out.push(head);

  if (target.kind === 33123) {
    const latestByRef = new Map<string, NostrEvent>();
    for (const ev of params.childTracks ?? []) {
      if (ev.kind !== 31683 || ev.pubkey !== me) continue;
      const ref = addressOf(ev);
      const known = latestByRef.get(ref);
      if (!known || ev.created_at > known.created_at) latestByRef.set(ref, ev);
    }
    for (const ref of ownedChildTrackRefs(target)) {
      const child = latestByRef.get(ref);
      if (!child) continue;
      const granted = await grantViewerOnEvent(child, requester, crypto, now);
      if (granted) out.push(granted);
    }
  }
  return out;
}
