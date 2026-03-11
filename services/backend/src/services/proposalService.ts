import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicProposals } from "../db/schema/proposals.js";
import { nanoid } from "../lib/id.js";

interface ProposalChange {
  type: "add_track" | "remove_track" | "reorder" | "update_metadata";
  trackRef?: string;
  position?: number;
  from?: number;
  to?: number;
  field?: string;
  value?: string;
}

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export const proposalService = {
  async indexProposal(event: NostrEvent) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const targetAlbum = event.tags.find((t) => t[0] === "a")?.[1];
    const ownerPubkey = event.tags.find((t) => t[0] === "p")?.[1];
    const status = event.tags.find((t) => t[0] === "status")?.[1] ?? "open";

    if (!targetAlbum || !ownerPubkey) return;

    let parsed: { title: string; description?: string; changes: ProposalChange[] };
    try {
      parsed = JSON.parse(event.content);
    } catch {
      return;
    }

    await db
      .insert(musicProposals)
      .values({
        id: nanoid(16),
        proposalId: dTag,
        addressableId: `31685:${event.pubkey}:${dTag}`,
        targetAlbum,
        proposerPubkey: event.pubkey,
        ownerPubkey,
        title: parsed.title,
        description: parsed.description ?? null,
        changes: parsed.changes as unknown as Record<string, unknown>,
        status,
        eventId: event.id,
        createdAt: event.created_at,
      })
      .onConflictDoNothing();
  },

  async getProposalsForAlbum(targetAlbum: string) {
    return db
      .select()
      .from(musicProposals)
      .where(eq(musicProposals.targetAlbum, targetAlbum))
      .orderBy(desc(musicProposals.createdAt));
  },

  async getIncomingProposals(ownerPubkey: string) {
    return db
      .select()
      .from(musicProposals)
      .where(
        and(
          eq(musicProposals.ownerPubkey, ownerPubkey),
          eq(musicProposals.status, "open"),
        ),
      )
      .orderBy(desc(musicProposals.createdAt));
  },

  async resolveProposal(id: string, status: "accepted" | "rejected", requesterPubkey: string) {
    // Verify the requester is the album owner
    const rows = await db
      .select()
      .from(musicProposals)
      .where(eq(musicProposals.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    if (rows[0].ownerPubkey !== requesterPubkey) return "forbidden";
    if (rows[0].status !== "open") return "already_resolved";

    const now = Math.floor(Date.now() / 1000);
    await db
      .update(musicProposals)
      .set({ status, resolvedAt: now })
      .where(eq(musicProposals.id, id));

    return "ok";
  },
};
