import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicRevisions } from "../db/schema/revisions.js";
import { nanoid } from "../lib/id.js";

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface RevisionChange {
  type: "audio_replaced" | "track_added" | "track_removed" | "track_reordered" |
        "metadata_changed" | "cover_changed" | "visibility_changed";
  field?: string;
  oldValue?: string;
  newValue?: string;
  trackRef?: string;
}

function getTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

/** Compute changes between two events */
function computeDiff(oldEvent: NostrEvent, newEvent: NostrEvent): RevisionChange[] {
  const changes: RevisionChange[] = [];

  // Compare metadata fields
  const metaFields = ["title", "artist", "genre", "license"];
  for (const field of metaFields) {
    const oldVal = getTagValue(oldEvent, field);
    const newVal = getTagValue(newEvent, field);
    if (oldVal !== newVal) {
      changes.push({
        type: "metadata_changed",
        field,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  // Compare cover/image
  const oldImage = getTagValue(oldEvent, "image");
  const newImage = getTagValue(newEvent, "image");
  if (oldImage !== newImage) {
    changes.push({ type: "cover_changed", oldValue: oldImage, newValue: newImage });
  }

  // Compare audio URL (from imeta tags)
  const oldAudioUrl = extractAudioUrl(oldEvent);
  const newAudioUrl = extractAudioUrl(newEvent);
  if (oldAudioUrl && newAudioUrl && oldAudioUrl !== newAudioUrl) {
    changes.push({ type: "audio_replaced", oldValue: oldAudioUrl, newValue: newAudioUrl });
  }

  // Compare visibility
  const oldVis = getTagValue(oldEvent, "visibility");
  const newVis = getTagValue(newEvent, "visibility");
  if (oldVis !== newVis) {
    changes.push({ type: "visibility_changed", oldValue: oldVis ?? "public", newValue: newVis ?? "public" });
  }

  // Compare track refs (for albums)
  const oldTrackRefs = oldEvent.tags.filter((t) => t[0] === "a" && t[1]?.startsWith("31683:")).map((t) => t[1]);
  const newTrackRefs = newEvent.tags.filter((t) => t[0] === "a" && t[1]?.startsWith("31683:")).map((t) => t[1]);

  // Added tracks
  for (const ref of newTrackRefs) {
    if (!oldTrackRefs.includes(ref)) {
      changes.push({ type: "track_added", trackRef: ref });
    }
  }
  // Removed tracks
  for (const ref of oldTrackRefs) {
    if (!newTrackRefs.includes(ref)) {
      changes.push({ type: "track_removed", trackRef: ref });
    }
  }
  // Reordered (same tracks, different order)
  if (oldTrackRefs.length === newTrackRefs.length &&
      oldTrackRefs.every((r) => newTrackRefs.includes(r)) &&
      oldTrackRefs.some((r, i) => newTrackRefs[i] !== r)) {
    changes.push({ type: "track_reordered" });
  }

  return changes;
}

function extractAudioUrl(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    for (let i = 1; i < tag.length; i++) {
      if (tag[i].startsWith("url ")) return tag[i].slice(4);
    }
  }
  return undefined;
}

export const revisionService = {
  async captureRevision(addressableId: string, event: NostrEvent) {
    // Get latest revision for this addressable ID
    const existing = await db
      .select()
      .from(musicRevisions)
      .where(eq(musicRevisions.addressableId, addressableId))
      .orderBy(desc(musicRevisions.version))
      .limit(1);

    const prevVersion = existing[0];
    // Use a subquery to atomically compute the next version number,
    // avoiding race conditions when two events arrive simultaneously
    const versionResult = await db.execute(
      sql`SELECT COALESCE(MAX(version), 0) + 1 AS next_version
          FROM ${musicRevisions}
          WHERE ${musicRevisions.addressableId} = ${addressableId}`,
    ) as unknown as { next_version: number }[];
    const newVersion = versionResult[0]?.next_version ?? (prevVersion ? prevVersion.version + 1 : 1);

    // Compute diff if there's a previous version
    let diffJson: RevisionChange[] | null = null;
    if (prevVersion) {
      const prevEvent = prevVersion.eventJson as unknown as NostrEvent;
      diffJson = computeDiff(prevEvent, event);
      // Skip if nothing actually changed (same event re-indexed)
      if (diffJson.length === 0 && prevVersion.eventId === event.id) return;
    }

    // Extract revision summary from event tags
    const summary = event.tags.find((t) => t[0] === "revision_summary")?.[1] ?? null;

    await db.insert(musicRevisions).values({
      id: nanoid(16),
      addressableId,
      kind: event.kind,
      pubkey: event.pubkey,
      version: newVersion,
      eventId: event.id,
      eventJson: event as unknown as Record<string, unknown>,
      summary,
      diffJson: diffJson as unknown as Record<string, unknown> | null,
      createdAt: event.created_at,
    }).onConflictDoNothing(); // unique constraint handles duplicates
  },

  async getRevisions(addressableId: string) {
    return db
      .select()
      .from(musicRevisions)
      .where(eq(musicRevisions.addressableId, addressableId))
      .orderBy(desc(musicRevisions.version));
  },

  async getRevision(addressableId: string, version: number) {
    const rows = await db
      .select()
      .from(musicRevisions)
      .where(
        and(
          eq(musicRevisions.addressableId, addressableId),
          eq(musicRevisions.version, version),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
};
