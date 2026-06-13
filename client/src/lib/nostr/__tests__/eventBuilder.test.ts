import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildProfileEvent,
  buildChatMessage,
  buildRootNote,
  buildPinnedNotesEvent,
  buildReply,
  buildReaction,
  buildRepost,
  buildQuoteNote,
  buildDeletionEvent,
  buildModDeletionEvent,
  buildChatEditEvent,
  buildFollowListEvent,
  buildMuteListEvent,
  buildRelayListEvent,
  buildDMRelayListEvent,
  buildPollEvent,
  buildPollVote,
} from "../eventBuilder";
import { lunaVega, marcusCole } from "@/__tests__/fixtures/testUsers";

const PK = lunaVega.pubkey;
const PK2 = marcusCole.pubkey;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
});

// ─── buildProfileEvent ───────────────────────────────────

describe("buildProfileEvent", () => {
  it("builds a kind:0 metadata event with correct fields", () => {
    const ev = buildProfileEvent(PK, { name: "Luna", about: "test" });
    expect(ev.kind).toBe(0);
    expect(ev.pubkey).toBe(PK);
    expect(ev.tags).toEqual([]);
    const parsed = JSON.parse(ev.content);
    expect(parsed.name).toBe("Luna");
    expect(parsed.about).toBe("test");
  });

  it("strips empty string values from content", () => {
    const ev = buildProfileEvent(PK, { name: "Luna", about: "", picture: "" });
    const parsed = JSON.parse(ev.content);
    expect(parsed.name).toBe("Luna");
    expect(parsed).not.toHaveProperty("about");
    expect(parsed).not.toHaveProperty("picture");
  });

  it("strips undefined values from content", () => {
    const ev = buildProfileEvent(PK, { name: "Luna", about: undefined });
    const parsed = JSON.parse(ev.content);
    expect(parsed).not.toHaveProperty("about");
  });

  it("throws on fully empty profile", () => {
    expect(() => buildProfileEvent(PK, {})).toThrow("empty profile");
    expect(() => buildProfileEvent(PK, { name: "", about: "" })).toThrow(
      "empty profile",
    );
  });

  it("sets created_at to current unix timestamp", () => {
    const ev = buildProfileEvent(PK, { name: "test" });
    expect(ev.created_at).toBe(Math.floor(Date.now() / 1000));
  });

  // ─── read-modify-write base merge ──────────────

  it("preserves base-only fields the form doesn't model (no wipe of lud06/custom)", () => {
    const base = { name: "Luna", lud06: "lnurl1xyz", nip57: "custom" } as Record<string, unknown>;
    const ev = buildProfileEvent(PK, { name: "Luna", about: "hi" }, base);
    const parsed = JSON.parse(ev.content);
    expect(parsed.lud06).toBe("lnurl1xyz");
    expect(parsed.nip57).toBe("custom");
    expect(parsed.about).toBe("hi");
  });

  it("lets the form override a base field of the same key", () => {
    const ev = buildProfileEvent(PK, { name: "New" }, { name: "Old", about: "keep" });
    const parsed = JSON.parse(ev.content);
    expect(parsed.name).toBe("New");
    expect(parsed.about).toBe("keep");
  });

  it("an empty-string form field removes a key that exists in base (intentional clear)", () => {
    const ev = buildProfileEvent(PK, { name: "Luna", about: "" }, { name: "Luna", about: "old bio" });
    const parsed = JSON.parse(ev.content);
    expect(parsed).not.toHaveProperty("about");
  });

  it("never serializes created_at into content (event-level only)", () => {
    const ev = buildProfileEvent(
      PK,
      { name: "Luna", created_at: 12345 },
      { created_at: 99999, lud16: "luna@x.com" },
    );
    const parsed = JSON.parse(ev.content);
    expect(parsed).not.toHaveProperty("created_at");
    expect(parsed.lud16).toBe("luna@x.com");
  });

  it("throws empty when base + form merge to nothing", () => {
    expect(() => buildProfileEvent(PK, { name: "" }, { name: "" })).toThrow("empty profile");
  });

  // ─── prototype-pollution hardening (untrusted base republished) ──

  it("drops __proto__ / constructor / prototype keys and never pollutes Object.prototype", () => {
    const malicious = JSON.parse(
      '{"name":"Luna","__proto__":{"polluted":true},"constructor":"x","prototype":"y"}',
    );
    const ev = buildProfileEvent(PK, { name: "Luna" }, malicious);
    const parsed = JSON.parse(ev.content);
    const own = (o: unknown, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    expect(parsed.name).toBe("Luna");
    expect(own(parsed, "__proto__")).toBe(false);
    expect(own(parsed, "constructor")).toBe(false);
    expect(own(parsed, "prototype")).toBe(false);
    // Global prototype must be untouched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ─── buildChatMessage ────────────────────────────────────

describe("buildChatMessage", () => {
  const GROUP = "test-group-id";

  it("builds a kind:9 event with h-tag", () => {
    const ev = buildChatMessage(PK, GROUP, "hello");
    expect(ev.kind).toBe(9);
    expect(ev.content).toBe("hello");
    expect(ev.tags).toContainEqual(["h", GROUP]);
  });

  it("adds channel tag when channelId provided", () => {
    const ev = buildChatMessage(PK, GROUP, "hello", undefined, "ch-123");
    expect(ev.tags).toContainEqual(["channel", "ch-123"]);
  });

  it("omits channel tag when channelId not provided", () => {
    const ev = buildChatMessage(PK, GROUP, "hello");
    expect(ev.tags.some((t) => t[0] === "channel")).toBe(false);
  });

  it("adds q-tag and p-tag for replies", () => {
    const replyTo = { eventId: "evt123", pubkey: PK2 };
    const ev = buildChatMessage(PK, GROUP, "reply", replyTo);
    expect(ev.tags).toContainEqual(["q", "evt123"]);
    expect(ev.tags).toContainEqual(["p", PK2]);
  });

  it("adds imeta tags for attachments", () => {
    const att = [
      {
        url: "https://example.com/img.png",
        mimeType: "image/png",
        sha256: "abc123",
        size: 1024,
      },
    ];
    const ev = buildChatMessage(PK, GROUP, "check this", undefined, undefined, att);
    const imetaTag = ev.tags.find((t) => t[0] === "imeta");
    expect(imetaTag).toBeDefined();
    expect(imetaTag).toContainEqual("url https://example.com/img.png");
    expect(imetaTag).toContainEqual("m image/png");
    expect(imetaTag).toContainEqual("x abc123");
    expect(imetaTag).toContainEqual("size 1024");
  });

  it("adds emoji tags", () => {
    const emojiTags = [["emoji", "custom", "https://example.com/emoji.png"]];
    const ev = buildChatMessage(
      PK, GROUP, ":custom:", undefined, undefined, undefined, emojiTags,
    );
    expect(ev.tags).toContainEqual(["emoji", "custom", "https://example.com/emoji.png"]);
  });
});

// ─── buildRootNote ───────────────────────────────────────

describe("buildRootNote", () => {
  it("builds a kind:1 event", () => {
    const ev = buildRootNote(PK, "Hello world");
    expect(ev.kind).toBe(1);
    expect(ev.content).toBe("Hello world");
    expect(ev.tags).toEqual([]);
  });

  it("adds p-tags for mentions", () => {
    const ev = buildRootNote(PK, "Hey!", [PK2]);
    expect(ev.tags).toContainEqual(["p", PK2]);
  });

  it("adds imeta tags for attachments", () => {
    const att = [
      { url: "https://img.com/a.jpg", mimeType: "image/jpeg", sha256: "def", size: 500 },
    ];
    const ev = buildRootNote(PK, "pic", undefined, att);
    expect(ev.tags.find((t) => t[0] === "imeta")).toBeDefined();
  });
});

// ─── buildPinnedNotesEvent ───────────────────────────────

describe("buildPinnedNotesEvent", () => {
  it("builds a kind:10001 event with e-tags", () => {
    const ev = buildPinnedNotesEvent(PK, ["evt1", "evt2"]);
    expect(ev.kind).toBe(10001);
    expect(ev.tags).toEqual([
      ["e", "evt1"],
      ["e", "evt2"],
    ]);
    expect(ev.content).toBe("");
  });
});

// ─── buildReply ──────────────────────────────────────────

describe("buildReply", () => {
  it("builds a kind:1 reply with NIP-10 root marker", () => {
    const ev = buildReply(PK, "nice", {
      eventId: "evt1",
      pubkey: PK2,
    });
    expect(ev.kind).toBe(1);
    expect(ev.tags).toContainEqual(["e", "evt1", "", "root"]);
    expect(ev.tags).toContainEqual(["p", PK2]);
  });

  it("adds separate root and reply markers when rootId differs", () => {
    const ev = buildReply(PK, "nested", {
      eventId: "evt2",
      pubkey: PK2,
      rootId: "evt1",
    });
    expect(ev.tags).toContainEqual(["e", "evt1", "", "root"]);
    expect(ev.tags).toContainEqual(["e", "evt2", "", "reply"]);
  });

  it("does not add reply marker when eventId equals rootId", () => {
    const ev = buildReply(PK, "top-level", {
      eventId: "evt1",
      pubkey: PK2,
      rootId: "evt1",
    });
    const replyTag = ev.tags.find(
      (t) => t[0] === "e" && t[3] === "reply",
    );
    expect(replyTag).toBeUndefined();
  });
});

// ─── buildReaction ───────────────────────────────────────

describe("buildReaction", () => {
  const target = { eventId: "evt1", pubkey: PK2, kind: 1 };

  it("builds a kind:7 event with e, p, k tags", () => {
    const ev = buildReaction(PK, target);
    expect(ev.kind).toBe(7);
    expect(ev.content).toBe("+");
    expect(ev.tags).toContainEqual(["e", "evt1"]);
    expect(ev.tags).toContainEqual(["p", PK2]);
    expect(ev.tags).toContainEqual(["k", "1"]);
  });

  it("uses custom content for reaction", () => {
    const ev = buildReaction(PK, target, "🔥");
    expect(ev.content).toBe("🔥");
  });

  it("adds custom emoji tag", () => {
    const ev = buildReaction(
      PK,
      target,
      ":fire:",
      ["emoji", "fire", "https://example.com/fire.png"],
    );
    expect(ev.tags).toContainEqual([
      "emoji", "fire", "https://example.com/fire.png",
    ]);
  });
});

// ─── buildRepost ─────────────────────────────────────────

describe("buildRepost", () => {
  it("builds a kind:6 event with e and p tags", () => {
    const ev = buildRepost(PK, { id: "evt1", pubkey: PK2 }, '{"content":"hi"}');
    expect(ev.kind).toBe(6);
    expect(ev.content).toBe('{"content":"hi"}');
    expect(ev.tags).toContainEqual(["e", "evt1"]);
    expect(ev.tags).toContainEqual(["p", PK2]);
  });
});

// ─── buildQuoteNote ──────────────────────────────────────

describe("buildQuoteNote", () => {
  it("builds a kind:1 with q-tag and p-tag", () => {
    const ev = buildQuoteNote(PK, "quoting this", {
      eventId: "evt1",
      pubkey: PK2,
    });
    expect(ev.kind).toBe(1);
    expect(ev.tags).toContainEqual(["q", "evt1", "", PK2]);
    expect(ev.tags).toContainEqual(["p", PK2]);
  });
});

// ─── buildDeletionEvent ──────────────────────────────────

describe("buildDeletionEvent", () => {
  it("builds a kind:5 event with e-tags", () => {
    const ev = buildDeletionEvent(PK, { eventIds: ["evt1", "evt2"] });
    expect(ev.kind).toBe(5);
    expect(ev.tags).toContainEqual(["e", "evt1"]);
    expect(ev.tags).toContainEqual(["e", "evt2"]);
    expect(ev.content).toBe("");
  });

  it("includes reason as content", () => {
    const ev = buildDeletionEvent(PK, { eventIds: ["evt1"] }, "spam");
    expect(ev.content).toBe("spam");
  });

  it("adds a-tags for addressable events", () => {
    const ev = buildDeletionEvent(PK, {
      addressableIds: ["30023:" + PK + ":my-article"],
    });
    expect(ev.tags).toContainEqual(["a", "30023:" + PK + ":my-article"]);
  });

  it("auto-extracts k-tags from addressable IDs", () => {
    const ev = buildDeletionEvent(PK, {
      addressableIds: ["30023:" + PK + ":slug"],
    });
    expect(ev.tags).toContainEqual(["k", "30023"]);
  });

  it("merges explicit kinds with auto-extracted kinds", () => {
    const ev = buildDeletionEvent(
      PK,
      { addressableIds: ["30023:" + PK + ":slug"] },
      undefined,
      ["1"],
    );
    const kTags = ev.tags.filter((t) => t[0] === "k");
    expect(kTags).toContainEqual(["k", "30023"]);
    expect(kTags).toContainEqual(["k", "1"]);
  });

  it("deduplicates k-tags", () => {
    const ev = buildDeletionEvent(
      PK,
      { addressableIds: ["30023:" + PK + ":a", "30023:" + PK + ":b"] },
    );
    const kTags = ev.tags.filter((t) => t[0] === "k");
    expect(kTags).toHaveLength(1);
    expect(kTags[0]).toEqual(["k", "30023"]);
  });
});

// ─── buildModDeletionEvent ───────────────────────────────

describe("buildModDeletionEvent", () => {
  it("builds a kind:9005 event with h-tag and e-tags", () => {
    const ev = buildModDeletionEvent(PK, "group1", ["evt1", "evt2"]);
    expect(ev.kind).toBe(9005);
    expect(ev.tags[0]).toEqual(["h", "group1"]);
    expect(ev.tags).toContainEqual(["e", "evt1"]);
    expect(ev.tags).toContainEqual(["e", "evt2"]);
  });

  it("includes reason as content", () => {
    const ev = buildModDeletionEvent(PK, "group1", ["evt1"], "rule violation");
    expect(ev.content).toBe("rule violation");
  });
});

// ─── buildChatEditEvent ──────────────────────────────────

describe("buildChatEditEvent", () => {
  it("builds a kind:9 edit event with edit marker tag", () => {
    const ev = buildChatEditEvent(PK, "group1", "orig-evt", "edited content");
    expect(ev.kind).toBe(9);
    expect(ev.content).toBe("edited content");
    expect(ev.tags).toContainEqual(["h", "group1"]);
    expect(ev.tags).toContainEqual(["e", "orig-evt", "", "edit"]);
  });

  it("includes channel tag when provided", () => {
    const ev = buildChatEditEvent(PK, "group1", "orig-evt", "edit", "ch-1");
    expect(ev.tags).toContainEqual(["channel", "ch-1"]);
  });
});

// ─── buildFollowListEvent ────────────────────────────────

describe("buildFollowListEvent", () => {
  it("builds a kind:3 event with p-tags", () => {
    const ev = buildFollowListEvent(PK, [PK2, "abc123"]);
    expect(ev.kind).toBe(3);
    expect(ev.tags).toEqual([
      ["p", PK2],
      ["p", "abc123"],
    ]);
    expect(ev.content).toBe("");
  });

  it("throws on empty follow list", () => {
    expect(() => buildFollowListEvent(PK, [])).toThrow("empty follow list");
  });
});

// ─── buildMuteListEvent ──────────────────────────────────

describe("buildMuteListEvent", () => {
  it("builds a kind:10000 event with correct tag types", () => {
    const ev = buildMuteListEvent(PK, [
      { type: "pubkey", value: PK2 },
      { type: "tag", value: "nsfw" },
      { type: "word", value: "spam" },
      { type: "event", value: "evt1" },
    ]);
    expect(ev.kind).toBe(10000);
    expect(ev.tags).toEqual([
      ["p", PK2],
      ["t", "nsfw"],
      ["word", "spam"],
      ["e", "evt1"],
    ]);
  });
});

// ─── buildRelayListEvent ─────────────────────────────────

describe("buildRelayListEvent", () => {
  it("builds a kind:10002 event with r-tags", () => {
    const ev = buildRelayListEvent(PK, [
      { url: "wss://relay1.com", mode: "read+write" },
      { url: "wss://relay2.com", mode: "read" },
      { url: "wss://relay3.com", mode: "write" },
    ]);
    expect(ev.kind).toBe(10002);
    expect(ev.tags).toEqual([
      ["r", "wss://relay1.com"],
      ["r", "wss://relay2.com", "read"],
      ["r", "wss://relay3.com", "write"],
    ]);
  });
});

// ─── buildDMRelayListEvent ───────────────────────────────

describe("buildDMRelayListEvent", () => {
  it("builds a kind:10050 event with relay tags", () => {
    const ev = buildDMRelayListEvent(PK, ["wss://dm1.com", "wss://dm2.com"]);
    expect(ev.kind).toBe(10050);
    expect(ev.tags).toEqual([
      ["relay", "wss://dm1.com"],
      ["relay", "wss://dm2.com"],
    ]);
  });
});

// ─── buildPollEvent ──────────────────────────────────────

describe("buildPollEvent", () => {
  it("builds a kind:1068 poll with NIP-88 tag layout", () => {
    const ev = buildPollEvent(
      PK,
      "Pineapple on pizza?",
      [
        { id: "opt1", label: "Yay" },
        { id: "opt2", label: "Nay" },
      ],
      {
        pollType: "multiplechoice",
        endsAt: 1750000000,
        relays: ["wss://relay.one"],
        spaceId: "space-1",
        channelId: "ch-9",
      },
    );
    expect(ev.kind).toBe(1068);
    expect(ev.content).toBe("Pineapple on pizza?");
    expect(ev.tags).toEqual([
      ["option", "opt1", "Yay"],
      ["option", "opt2", "Nay"],
      ["relay", "wss://relay.one"],
      ["polltype", "multiplechoice"],
      ["endsAt", "1750000000"],
      ["h", "space-1"],
      ["channel", "ch-9"],
      ["alt", "Poll: Pineapple on pizza?"],
    ]);
  });

  it("writes polltype explicitly even for the singlechoice default", () => {
    const ev = buildPollEvent(PK, "Q?", [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    expect(ev.tags).toContainEqual(["polltype", "singlechoice"]);
    expect(ev.tags.some((t) => t[0] === "endsAt")).toBe(false);
    expect(ev.tags.some((t) => t[0] === "h")).toBe(false);
  });

  it("emits supplemental track tags for music options", () => {
    const ev = buildPollEvent(PK, "Best track?", [
      { id: "a", label: "Artist — Song", trackAddress: `31683:${PK2}:my-track` },
      { id: "b", label: "Plain option" },
    ]);
    expect(ev.tags).toContainEqual(["track", "a", `31683:${PK2}:my-track`]);
    expect(ev.tags.filter((t) => t[0] === "track")).toHaveLength(1);
  });

  it("omits channel tag without a space id", () => {
    const ev = buildPollEvent(PK, "Q?", [{ id: "a", label: "A" }], {
      channelId: "ch-9",
    });
    expect(ev.tags.some((t) => t[0] === "channel")).toBe(false);
  });
});

// ─── buildPollVote ───────────────────────────────────────

describe("buildPollVote", () => {
  it("builds a kind:1018 vote with e + response tags", () => {
    const ev = buildPollVote(PK, "poll-id", ["opt1", "opt2"]);
    expect(ev.kind).toBe(1018);
    expect(ev.content).toBe("");
    expect(ev.tags).toEqual([
      ["e", "poll-id"],
      ["response", "opt1"],
      ["response", "opt2"],
    ]);
  });

  it("adds an h tag for space-scoped votes", () => {
    const ev = buildPollVote(PK, "poll-id", ["opt1"], { spaceId: "space-1" });
    expect(ev.tags).toContainEqual(["h", "space-1"]);
  });
});
