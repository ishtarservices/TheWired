/**
 * Saved-version update tracking for music (WIR-165).
 *
 * A fan "saves" the version of a track/project they have; the ingester flags
 * the row when a strictly newer event for that address arrives. The rules that
 * make the banner trustworthy live here:
 *
 *  - flag only when the event is NEWER than the saved version and is not the
 *    saved event itself (re-ingesting the same event on a relay backfill is a
 *    no-op);
 *  - remember the newest event seen (`latest_*`) and never move it backwards;
 *  - acknowledging resolves to the newest known version, whichever side
 *    (client or ingester) saw it, so a stale client can't "acknowledge" an old
 *    event and have the flag come straight back;
 *  - a non-public event only flags fans the event is addressed to (p-tags) —
 *    everyone else can't fetch it, so an update banner would be a dead end.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { savedAlbumVersions } from "../db/schema/savedVersions.js";

export interface SavedVersionRow {
  addressableId: string;
  savedEventId: string;
  savedCreatedAt: number;
  hasUpdate: boolean;
  latestEventId: string | null;
  latestCreatedAt: number | null;
}

interface VersionEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
}

type DbRow = typeof savedAlbumVersions.$inferSelect;

function toApiRow(row: DbRow): SavedVersionRow {
  return {
    addressableId: row.addressableId,
    savedEventId: row.savedEventId,
    savedCreatedAt: row.savedCreatedAt,
    hasUpdate: row.hasUpdate ?? false,
    latestEventId: row.latestEventId ?? null,
    latestCreatedAt: row.latestCreatedAt ?? null,
  };
}

export function addressableIdOf(event: VersionEvent): string | null {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (dTag === undefined) return null;
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

export const savedVersionService = {
  /**
   * Flag every fan whose saved version of this address is older than `event`.
   * Returns the pubkeys of the rows flagged (the ingester pushes to exactly
   * these — a re-ingest flags nobody, so it pushes to nobody). `audience`
   * limits the flag to those pubkeys (used for non-public events); null =
   * everyone who saved it.
   */
  async flagUpdates(event: VersionEvent, audience: string[] | null = null): Promise<string[]> {
    const addr = addressableIdOf(event);
    if (!addr) return [];
    if (audience !== null && audience.length === 0) return [];

    const audienceClause =
      audience === null
        ? sql``
        : sql` AND pubkey IN (${sql.join(audience.map((p) => sql`${p}`), sql`, `)})`;

    const rows = (await db.execute(sql`
      UPDATE app.saved_album_versions
         SET has_update = TRUE,
             latest_event_id = ${event.id},
             latest_created_at = ${event.created_at}
       WHERE addressable_id = ${addr}
         AND saved_event_id <> ${event.id}
         AND saved_created_at < ${event.created_at}
         AND (latest_created_at IS NULL OR latest_created_at < ${event.created_at})
         ${audienceClause}
      RETURNING pubkey
    `)) as unknown as Array<{ pubkey: string }>;
    return rows.map((r) => r.pubkey);
  },

  async list(pubkey: string): Promise<SavedVersionRow[]> {
    const rows = await db
      .select()
      .from(savedAlbumVersions)
      .where(eq(savedAlbumVersions.pubkey, pubkey));
    return rows.map(toApiRow);
  },

  /** Record the version the fan has. Keeps the update flag only if the
   *  ingester already knows a newer event than the one being saved. */
  async save(pubkey: string, addressableId: string, eventId: string, createdAt: number): Promise<SavedVersionRow> {
    const [row] = await db
      .insert(savedAlbumVersions)
      .values({ pubkey, addressableId, savedEventId: eventId, savedCreatedAt: createdAt, hasUpdate: false })
      .onConflictDoUpdate({
        target: [savedAlbumVersions.pubkey, savedAlbumVersions.addressableId],
        set: {
          savedEventId: eventId,
          savedCreatedAt: createdAt,
          hasUpdate: sql`COALESCE(${savedAlbumVersions.latestCreatedAt} > ${createdAt}
                           AND ${savedAlbumVersions.latestEventId} <> ${eventId}, FALSE)`,
        },
      })
      .returning();
    return toApiRow(row);
  },

  /** Bulk `save` (one request for an album + its cascaded tracks). */
  async saveMany(pubkey: string, items: Array<{ addressableId: string; eventId: string; createdAt: number }>): Promise<SavedVersionRow[]> {
    if (items.length === 0) return [];
    // Last write wins within the batch for a duplicate address.
    const byAddr = new Map(items.map((i) => [i.addressableId, i]));
    const rows = await db
      .insert(savedAlbumVersions)
      .values([...byAddr.values()].map((i) => ({
        pubkey,
        addressableId: i.addressableId,
        savedEventId: i.eventId,
        savedCreatedAt: i.createdAt,
        hasUpdate: false,
      })))
      .onConflictDoUpdate({
        target: [savedAlbumVersions.pubkey, savedAlbumVersions.addressableId],
        set: {
          savedEventId: sql`excluded.saved_event_id`,
          savedCreatedAt: sql`excluded.saved_created_at`,
          hasUpdate: sql`COALESCE(${savedAlbumVersions.latestCreatedAt} > excluded.saved_created_at
                           AND ${savedAlbumVersions.latestEventId} <> excluded.saved_event_id, FALSE)`,
        },
      })
      .returning();
    return rows.map(toApiRow);
  },

  /**
   * The fan has seen the update. The saved version becomes the NEWEST known
   * event: the client's, or the ingester's `latest_*` if that is newer (the
   * client may not have received the new event from a relay yet).
   */
  async acknowledge(pubkey: string, addressableId: string, eventId: string, createdAt: number): Promise<SavedVersionRow | null> {
    const [row] = await db
      .update(savedAlbumVersions)
      .set({
        savedEventId: sql`CASE WHEN ${savedAlbumVersions.latestCreatedAt} > ${createdAt}
                               THEN ${savedAlbumVersions.latestEventId} ELSE ${eventId} END`,
        savedCreatedAt: sql`GREATEST(COALESCE(${savedAlbumVersions.latestCreatedAt}, 0), ${createdAt})`,
        hasUpdate: false,
      })
      .where(and(eq(savedAlbumVersions.pubkey, pubkey), eq(savedAlbumVersions.addressableId, addressableId)))
      .returning();
    return row ? toApiRow(row) : null;
  },

  async forget(pubkey: string, addressableIds: string[]): Promise<void> {
    if (addressableIds.length === 0) return;
    await db
      .delete(savedAlbumVersions)
      .where(and(eq(savedAlbumVersions.pubkey, pubkey), inArray(savedAlbumVersions.addressableId, addressableIds)));
  },
};
