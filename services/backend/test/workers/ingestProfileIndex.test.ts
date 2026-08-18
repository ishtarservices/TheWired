import { describe, it, expect, beforeEach, vi } from "vitest";
import { finalizeEvent } from "nostr-tools";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { processEvent, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

/**
 * kind:0 ingest owns the profile index's text fields; profileStatsComputer owns
 * `note_count`. They must not clobber each other, and `has_nip05` has to be
 * written here (the only place that sees the parsed profile) for the people
 * browse filter to work at all.
 */

const ownCtx: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };

let index: { updateDocuments: ReturnType<typeof vi.fn>; addDocuments: ReturnType<typeof vi.fn> };

beforeEach(() => {
  index = getMeilisearchClient().index("profiles") as never;
  index.updateDocuments.mockClear();
  index.addDocuments.mockClear();
});

let clock = 1_800_000_000;
function profileEvent(user: typeof LUNA, profile: Record<string, unknown>): NostrEvent {
  clock += 1; // each kind:0 must be newer, or profileCacheService rejects it as stale
  return finalizeEvent(
    { kind: 0, created_at: clock, tags: [], content: JSON.stringify(profile) },
    user.secretKey,
  ) as NostrEvent;
}

function lastDoc() {
  const calls = index.updateDocuments.mock.calls;
  return calls[calls.length - 1][0][0];
}

describe("kind:0 ingest → profiles index", () => {
  it("marks a profile with a NIP-05 as verified", async () => {
    await processEvent(profileEvent(LUNA, { name: "luna", nip05: "luna@thewired.app" }), ownCtx);

    expect(lastDoc()).toMatchObject({
      pubkey: LUNA.pubkey,
      name: "luna",
      nip05: "luna@thewired.app",
      has_nip05: true,
    });
  });

  it("marks a profile without a NIP-05 as unverified rather than omitting the field", async () => {
    await processEvent(profileEvent(MARCUS, { name: "marcus" }), ownCtx);

    const doc = lastDoc();
    expect(doc.pubkey).toBe(MARCUS.pubkey);
    // Omitting it would make `has_nip05 = false` miss this person entirely.
    expect(doc.has_nip05).toBe(false);
  });

  it("treats an empty nip05 string as unverified", async () => {
    await processEvent(profileEvent(LUNA, { name: "luna", nip05: "" }), ownCtx);
    expect(lastDoc().has_nip05).toBe(false);
  });

  it("uses a partial update, never a full replace that would wipe note_count", async () => {
    await processEvent(profileEvent(LUNA, { name: "luna" }), ownCtx);

    expect(index.updateDocuments).toHaveBeenCalled();
    expect(index.addDocuments).not.toHaveBeenCalled();
    // The worker's field is absent from the payload — so Meilisearch merges
    // rather than resetting it.
    expect(lastDoc()).not.toHaveProperty("note_count");
  });

  it("ignores a kind:0 relayed by a foreign relay", async () => {
    const extCtx: IngestContext = {
      relayUrl: "wss://ext",
      isOwnRelay: false,
      allowedSpaceIds: new Set(["spaceA"]),
    };
    await processEvent(profileEvent(LUNA, { name: "impostor" }), extCtx);
    expect(index.updateDocuments).not.toHaveBeenCalled();
  });
});
