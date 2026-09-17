/**
 * Which pushes does one ingested event produce?
 *
 * PURE and synchronous over pre-fetched deps (the planIngest idea): the
 * emitter (workers/ingestHandlers.emitNotifications) gathers parent authors,
 * display names, space names and watchers, then calls this; the intents go
 * through services/notificationEnqueue (per-user preference gate) into the
 * queue the dispatcher drains.
 *
 * Privacy stance — this is the one place push bodies are written:
 *  - DM pushes carry NO sender, text or thread: title "soot", body
 *    "new message". The gift wrap's author is ephemeral and its content
 *    opaque; we only know the recipient (`p`).
 *  - reply / mention / reaction / zap / chat / post pushes carry short
 *    previews of PUBLIC relay content only.
 *  - release pushes carry the public title.
 * Every event here reached our own relay (the emitter gates on isOwnRelay);
 * anything published only elsewhere never pushes — best-effort by design.
 *
 * Voice: lowercase, deadpan, no exclamation points (soot brief §03).
 */

import type { IngestContext, NostrEvent } from "../../workers/ingestHandlers.js";
import { parseZapSats } from "../nostr/zapAmount.js";

export type NotificationType =
  | "reply"
  | "mention"
  | "reaction"
  | "zap"
  | "chat"
  | "dm"
  | "post"
  | "release"
  | "friend_request"
  | "follow";

export interface NotificationIntent {
  recipient: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link the tap opens (soot://…). */
  url: string;
  /** Rows sharing (recipient, collapseKey) send as one push. */
  collapseKey: string;
  data: Record<string, unknown>;
}

export interface PlanDeps {
  /** Author of a note id we have in relay.events (undefined = unknown). */
  parentAuthorOf(eventId: string): string | undefined;
  /** Short public preview of a note we have (undefined = unknown). */
  notePreviewOf(eventId: string): string | undefined;
  /** Display name, falling back to a short npub-ish handle. */
  displayName(pubkey: string): string;
  spaceName(spaceId: string): string | undefined;
  /** Pubkeys subscribed to this author (app.watched_by). */
  watchersOf(author: string): string[];
}

export const PREVIEW_MAX = 120;
export const KIND_GIFT_WRAP = 1059;
export const RELEASE_KINDS = new Set([31683, 33123]);

const tagValue = (event: NostrEvent, name: string): string | undefined =>
  event.tags.find((t) => t[0] === name)?.[1];

/** Distinct `p` recipients other than the author. */
function mentionedPubkeys(event: NostrEvent): string[] {
  const out: string[] = [];
  for (const t of event.tags) {
    if (t[0] === "p" && t[1] && t[1] !== event.pubkey && !out.includes(t[1])) out.push(t[1]);
  }
  return out;
}

/** Collapse nostr entities, whitespace; cap length. Exported for tests. */
export function preview(content: string, max = PREVIEW_MAX): string {
  const clean = content
    .replace(/nostr:(npub|nprofile|nevent|naddr|note)1[a-z0-9]+/gi, "@mention")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/** NIP-10: the note this one replies to — `reply` marker, else `root`
 *  marker, else the LAST positional `e` (deprecated positional scheme). */
export function threadParentId(event: NostrEvent): string | undefined {
  let reply: string | undefined;
  let root: string | undefined;
  let lastPositional: string | undefined;
  let sawMarker = false;
  for (const t of event.tags) {
    if (t[0] !== "e" || !t[1]) continue;
    const marker = t[3];
    if (marker === "reply") reply = t[1];
    else if (marker === "root") root = t[1];
    else if (marker === "mention") continue;
    else lastPositional = t[1];
    if (marker) sawMarker = true;
  }
  if (reply) return reply;
  if (root) return root;
  return sawMarker ? undefined : lastPositional;
}

function releaseAddress(event: NostrEvent): string | undefined {
  const d = tagValue(event, "d");
  return d ? `${event.kind}:${event.pubkey}:${d}` : undefined;
}

export function planNotifications(
  event: NostrEvent,
  ctx: IngestContext,
  deps: PlanDeps,
): NotificationIntent[] {
  // Only traffic on our own relay is trusted for pushes: a foreign relay must
  // not be able to make us push arbitrary people about arbitrary content.
  if (!ctx.isOwnRelay) return [];
  const out: NotificationIntent[] = [];
  const name = () => deps.displayName(event.pubkey);

  switch (event.kind) {
    case 1: {
      const parentId = threadParentId(event);
      const parentAuthor = parentId ? deps.parentAuthorOf(parentId) : undefined;
      const body = preview(event.content);
      const tagged = mentionedPubkeys(event);
      for (const recipient of tagged) {
        const isReply = !!parentId && parentAuthor === recipient;
        out.push({
          recipient,
          type: isReply ? "reply" : "mention",
          title: isReply ? `reply from ${name()}` : `${name()} mentioned you`,
          body,
          url: `soot://note/${isReply ? parentId : event.id}`,
          collapseKey: `activity:${recipient}`,
          data: { eventId: event.id, actor: event.pubkey },
        });
      }
      // Subscribed authors: top-level PUBLIC notes only — a reply is not a
      // post, and a space-exclusive (h-tagged) note must not reach watchers
      // outside the space.
      if (!parentId && !tagValue(event, "h")) {
        for (const watcher of deps.watchersOf(event.pubkey)) {
          if (watcher === event.pubkey || tagged.includes(watcher)) continue;
          out.push({
            recipient: watcher,
            type: "post",
            title: name(),
            body,
            url: `soot://note/${event.id}`,
            collapseKey: `release:${watcher}`,
            data: { eventId: event.id, actor: event.pubkey },
          });
        }
      }
      return out;
    }

    case 7: {
      const target = [...event.tags].reverse().find((t) => t[0] === "e")?.[1];
      if (!target) return out;
      // Content is attacker-controlled: treat it as an emoji only when it is
      // plausibly one, so a kilobyte of text can't become the push title.
      const emoji =
        event.content && event.content !== "+" && event.content.length <= 20 ? event.content : "";
      const targetAuthor = deps.parentAuthorOf(target);
      for (const recipient of mentionedPubkeys(event)) {
        // The target's preview is only for its author — a p-tag doesn't
        // entitle an arbitrary recipient to another note's content.
        const targetPreview = targetAuthor === recipient ? deps.notePreviewOf(target) : undefined;
        out.push({
          recipient,
          type: "reaction",
          title: emoji ? `${name()} reacted ${emoji}` : `${name()} liked your note`,
          body: targetPreview ? preview(targetPreview, 80) : "",
          url: `soot://note/${target}`,
          collapseKey: `activity:${recipient}`,
          data: { eventId: event.id, actor: event.pubkey, targetEventId: target },
        });
      }
      return out;
    }

    case 9735: {
      const recipient = tagValue(event, "p");
      if (!recipient) return out;
      let zapper: string | undefined;
      let comment = "";
      const description = tagValue(event, "description");
      if (description) {
        try {
          const req = JSON.parse(description) as { pubkey?: string; content?: string };
          if (typeof req.pubkey === "string") zapper = req.pubkey;
          if (typeof req.content === "string") comment = req.content;
        } catch {
          // malformed 9734 — fall through
        }
      }
      if (!zapper) zapper = tagValue(event, "P");
      if (!zapper || zapper === recipient) return out;
      const sats = parseZapSats(event.tags);
      if (sats <= 0) return out;
      const target = tagValue(event, "e");
      out.push({
        recipient,
        type: "zap",
        title: `${sats} sats from ${deps.displayName(zapper)}`,
        body: preview(comment, 80),
        url: target ? `soot://note/${target}` : `soot://profile/${zapper}`,
        collapseKey: `activity:${recipient}`,
        data: { eventId: event.id, actor: zapper, sats, targetEventId: target },
      });
      return out;
    }

    case 9: {
      const spaceId = tagValue(event, "h");
      if (!spaceId) return out;
      const channel = tagValue(event, "channel");
      const spaceName = deps.spaceName(spaceId) ?? "a space";
      const body = preview(event.content);
      for (const recipient of mentionedPubkeys(event)) {
        out.push({
          recipient,
          type: "chat",
          title: `${name()} in ${spaceName}`,
          body,
          url: channel ? `soot://space/${spaceId}/channel/${channel}` : `soot://space/${spaceId}`,
          collapseKey: `space:${spaceId}:${recipient}`,
          data: { eventId: event.id, actor: event.pubkey, spaceId, channelId: channel },
        });
      }
      return out;
    }

    case KIND_GIFT_WRAP: {
      // Content-free by construction: we know only who it is FOR.
      const recipient = tagValue(event, "p");
      if (!recipient) return out;
      out.push({
        recipient,
        type: "dm",
        title: "soot",
        body: "new message",
        url: "soot://dm",
        collapseKey: `dm:${recipient}`,
        data: { eventId: event.id },
      });
      return out;
    }

    default: {
      if (!RELEASE_KINDS.has(event.kind)) return out;
      const address = releaseAddress(event);
      if (!address) return out;
      const visibility = tagValue(event, "visibility");
      if (visibility === "private" || visibility === "unlisted") return out;
      // Space-exclusive (h-tagged) releases are non-public everywhere else
      // (isNonPublicEvent); watchers may not be members of the space.
      if (tagValue(event, "h")) return out;
      const title = tagValue(event, "title") ?? "untitled";
      const noun = event.kind === 31683 ? "track" : "project";
      const tagged = mentionedPubkeys(event);
      for (const watcher of deps.watchersOf(event.pubkey)) {
        if (watcher === event.pubkey || tagged.includes(watcher)) continue;
        out.push({
          recipient: watcher,
          type: "release",
          title: name(),
          body: `new ${noun}: ${preview(title, 80)}`,
          url: `soot://music/${noun === "track" ? "track" : "album"}/${address}`,
          collapseKey: `release:${watcher}`,
          data: { address, actor: event.pubkey, kind: event.kind },
        });
      }
      return out;
    }
  }
}
