import { describe, it, expect } from "vitest";
import { planIngest, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";

/**
 * Pure unit tests for the ingestion trust gates. `planIngest` makes the routing
 * decision with no side effects, so these prove the security boundary directly:
 *  - global kinds are own-relay only (a foreign relay can't poison them),
 *  - space-scoped kinds obey allowedSpaceIds (anti-poisoning),
 *  - app.space_members writes are own-relay only,
 *  - 39000/39002 are trusted only from the relay's own signing key.
 */

const RELAY_KEY = "relaypubkey";

function ev(kind: number, tags: string[][] = [], pubkey = "author"): NostrEvent {
  return { id: "id", pubkey, created_at: 1_700_000_000, kind, tags, content: "", sig: "sig" };
}

const ownCtx: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const extCtx: IngestContext = {
  relayUrl: "wss://ext",
  isOwnRelay: false,
  allowedSpaceIds: new Set(["spaceA"]),
  relayPubkey: RELAY_KEY,
};

describe("planIngest — own relay", () => {
  it("indexes global kinds (profile/zap/music/proposal/deletion)", () => {
    expect(planIngest(ev(0), ownCtx).action).toBe("profile");
    expect(planIngest(ev(9735, [["e", "x"]]), ownCtx).action).toBe("zap");
    expect(planIngest(ev(31683), ownCtx).action).toBe("musicTrack");
    expect(planIngest(ev(33123), ownCtx).action).toBe("musicAlbum");
    expect(planIngest(ev(31685), ownCtx).action).toBe("proposal");
    expect(planIngest(ev(5), ownCtx).action).toBe("deletion");
  });

  it("indexes chat / membership / metadata for any space (allowedSpaceIds=null)", () => {
    expect(planIngest(ev(9, [["h", "anything"]]), ownCtx).action).toBe("chat");
    expect(planIngest(ev(9021, [["h", "anything"]]), ownCtx).action).toBe("join");
    expect(planIngest(ev(9022, [["h", "anything"]]), ownCtx).action).toBe("leave");
    // From our own relay, 39002 is trusted regardless of author.
    expect(planIngest(ev(39002, [["d", "anything"]], "anyone"), ownCtx).action).toBe("groupMembers");
  });

  it("indexes all searchable content kinds to Meilisearch", () => {
    for (const k of [1, 9, 22, 30023, 34236, 30119]) {
      expect(planIngest(ev(k, [["h", "x"]]), ownCtx).indexSearch).toBe(true);
    }
  });
});

describe("planIngest — external relay (own-relay gate)", () => {
  it("DROPS global kinds from an external relay", () => {
    for (const k of [0, 9735, 31683, 33123, 31685, 5]) {
      expect(planIngest(ev(k), extCtx).action).toBeNull();
    }
  });

  it("DROPS app.space_members writes (9021/9022) from an external relay", () => {
    expect(planIngest(ev(9021, [["h", "spaceA"]]), extCtx).action).toBeNull();
    expect(planIngest(ev(9022, [["h", "spaceA"]]), extCtx).action).toBeNull();
  });
});

describe("planIngest — anti-poisoning (allowedSpaceIds)", () => {
  it("accepts chat for an allowed space", () => {
    expect(planIngest(ev(9, [["h", "spaceA"]]), extCtx).action).toBe("chat");
    expect(planIngest(ev(7, [["h", "spaceA"], ["e", "x"]]), extCtx).action).toBe("reaction");
  });

  it("DROPS chat for a space registered to a different relay", () => {
    expect(planIngest(ev(9, [["h", "spaceB"]]), extCtx).action).toBeNull();
    expect(planIngest(ev(7, [["h", "spaceB"]]), extCtx).action).toBeNull();
  });

  it("DROPS chat with no h-tag", () => {
    expect(planIngest(ev(9, []), extCtx).action).toBeNull();
  });

  it("only search-indexes the scoped chat (not other content) from an external relay", () => {
    expect(planIngest(ev(9, [["h", "spaceA"]]), extCtx).indexSearch).toBe(true);
    expect(planIngest(ev(9, [["h", "spaceB"]]), extCtx).indexSearch).toBe(false);
    expect(planIngest(ev(1, []), extCtx).indexSearch).toBe(false); // notes aren't this group's content
    expect(planIngest(ev(30023, []), extCtx).indexSearch).toBe(false);
  });
});

describe("planIngest — metadata authority (relay key)", () => {
  it("accepts 39000/39002 signed by the relay key for an allowed space", () => {
    expect(planIngest(ev(39000, [["d", "spaceA"]], RELAY_KEY), extCtx).action).toBe("groupMetadata");
    expect(planIngest(ev(39002, [["d", "spaceA"]], RELAY_KEY), extCtx).action).toBe("groupMembers");
  });

  it("REJECTS forged 39002 from a non-relay author (the forgery vector)", () => {
    expect(planIngest(ev(39002, [["d", "spaceA"]], "attacker"), extCtx).action).toBeNull();
    expect(planIngest(ev(39000, [["d", "spaceA"]], "attacker"), extCtx).action).toBeNull();
  });

  it("REJECTS relay-signed metadata for a non-allowed space", () => {
    expect(planIngest(ev(39002, [["d", "spaceB"]], RELAY_KEY), extCtx).action).toBeNull();
  });

  it("REJECTS metadata when the relay key is unknown", () => {
    const noKey: IngestContext = { ...extCtx, relayPubkey: undefined };
    expect(planIngest(ev(39002, [["d", "spaceA"]], RELAY_KEY), noKey).action).toBeNull();
  });
});
