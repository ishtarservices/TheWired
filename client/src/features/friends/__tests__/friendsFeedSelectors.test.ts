import { describe, it, expect } from "vitest";
import type { RootState } from "@/store";
import type { NostrEvent } from "@/types/nostr";
import type { MuteEntry } from "@/store/slices/identitySlice";
import {
  selectFriendsFeedNotes,
  selectFriendsFeedNoteIds,
  selectFriendsFeedMediaEvents,
  selectFriendsFeedArticles,
} from "../friendsFeedSelectors";
import { FRIENDS_FEED_ID } from "../friendsFeedConstants";

function note(id: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id,
    pubkey: "pk",
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

interface StateOpts {
  entities?: Record<string, NostrEvent>;
  noteIds?: string[];
  mediaIds?: string[];
  articleIds?: string[];
  muteList?: MuteEntry[];
  showReplies?: boolean;
  showReposts?: boolean;
  hiddenPubkeys?: string[];
}

function makeState({
  entities = {},
  noteIds = [],
  mediaIds = [],
  articleIds = [],
  muteList = [],
  showReplies = false,
  showReposts = false,
  hiddenPubkeys = [],
}: StateOpts = {}): RootState {
  return {
    spaces: { activeSpaceId: FRIENDS_FEED_ID },
    events: {
      spaceFeeds: {
        [`${FRIENDS_FEED_ID}:notes`]: noteIds,
        [`${FRIENDS_FEED_ID}:media`]: mediaIds,
        [`${FRIENDS_FEED_ID}:articles`]: articleIds,
      },
      entities,
      longform: {},
    },
    identity: { muteList },
    feedPrefs: { showReplies, showReposts, hiddenPubkeys },
  } as unknown as RootState;
}

describe("selectFriendsFeedNotes — visibility filtering", () => {
  it("drops notes from NIP-51 muted authors entirely", () => {
    const good = note("good", { pubkey: "alice" });
    const bad = note("bad", { pubkey: "mallory" });
    const r = selectFriendsFeedNotes(
      makeState({
        entities: { good, bad },
        noteIds: ["good", "bad"],
        muteList: [{ type: "pubkey", value: "mallory" }],
      }),
    );
    expect(r.map((n) => n.id)).toEqual(["good"]);
  });

  it("drops notes from locally hidden authors", () => {
    const good = note("good", { pubkey: "alice" });
    const noisy = note("noisy", { pubkey: "bob" });
    const r = selectFriendsFeedNotes(
      makeState({
        entities: { good, noisy },
        noteIds: ["good", "noisy"],
        hiddenPubkeys: ["bob"],
      }),
    );
    expect(r.map((n) => n.id)).toEqual(["good"]);
  });

  it("drops notes matching a muted word, case-insensitively", () => {
    const ham = note("ham", { content: "gm friends" });
    const spam = note("spam", { content: "Buy CHEAP SATS now" });
    const r = selectFriendsFeedNotes(
      makeState({
        entities: { ham, spam },
        noteIds: ["ham", "spam"],
        muteList: [{ type: "word", value: "cheap sats" }],
      }),
    );
    expect(r.map((n) => n.id)).toEqual(["ham"]);
  });

  it("excludes replies by default and includes them with showReplies", () => {
    const root = note("root");
    const reply = note("reply", { tags: [["e", "root", "", "reply"]] });
    const base = {
      entities: { root, reply },
      noteIds: ["root", "reply"],
    };
    expect(
      selectFriendsFeedNotes(makeState(base)).map((n) => n.id),
    ).toEqual(["root"]);
    expect(
      selectFriendsFeedNotes(makeState({ ...base, showReplies: true })).map((n) => n.id),
    ).toEqual(["root", "reply"]);
  });

  it("excludes reposts by default and includes them with showReposts", () => {
    const root = note("root");
    const repost = note("repost", { kind: 6, tags: [["e", "orig"]] });
    const base = {
      entities: { root, repost },
      noteIds: ["root", "repost"],
    };
    expect(
      selectFriendsFeedNotes(makeState(base)).map((n) => n.id),
    ).toEqual(["root"]);
    expect(
      selectFriendsFeedNotes(makeState({ ...base, showReposts: true })).map((n) => n.id),
    ).toEqual(["root", "repost"]);
  });

  it("drops reposts whose reposter is muted even with showReposts on", () => {
    const repost = note("repost", { kind: 6, pubkey: "mallory", tags: [["e", "orig"]] });
    const r = selectFriendsFeedNotes(
      makeState({
        entities: { repost },
        noteIds: ["repost"],
        showReposts: true,
        muteList: [{ type: "pubkey", value: "mallory" }],
      }),
    );
    expect(r).toEqual([]);
  });
});

describe("selectFriendsFeedNoteIds", () => {
  it("maps reposts to the original note id (for the engagement sub)", () => {
    const root = note("root");
    const repost = note("repost", { kind: 6, tags: [["e", "orig-id"]] });
    const ids = selectFriendsFeedNoteIds(
      makeState({
        entities: { root, repost },
        noteIds: ["root", "repost"],
        showReposts: true,
      }),
    );
    expect(ids).toEqual(["root", "orig-id"]);
  });
});

describe("selectFriendsFeedMediaEvents / Articles", () => {
  it("filters muted and hidden authors out of the media channel", () => {
    const pic = note("pic", { kind: 20, pubkey: "alice" });
    const mutedPic = note("mutedPic", { kind: 20, pubkey: "mallory" });
    const hiddenPic = note("hiddenPic", { kind: 20, pubkey: "bob" });
    const r = selectFriendsFeedMediaEvents(
      makeState({
        entities: { pic, mutedPic, hiddenPic },
        mediaIds: ["pic", "mutedPic", "hiddenPic"],
        muteList: [{ type: "pubkey", value: "mallory" }],
        hiddenPubkeys: ["bob"],
      }),
    );
    expect(r.map((n) => n.id)).toEqual(["pic"]);
  });

  it("filters muted authors out of the articles channel", () => {
    const article = note("art", { kind: 30023, pubkey: "alice" });
    const mutedArticle = note("mutedArt", { kind: 30023, pubkey: "mallory" });
    const r = selectFriendsFeedArticles(
      makeState({
        entities: { art: article, mutedArt: mutedArticle },
        articleIds: ["art", "mutedArt"],
        muteList: [{ type: "pubkey", value: "mallory" }],
      }),
    );
    expect(r.map((n) => n.id)).toEqual(["art"]);
  });
});

describe("selectFriendsFeedNotes — reference stability", () => {
  it("keeps the same array reference when an unrelated entity is added", () => {
    const a = note("a", { created_at: 2 });
    const b = note("b", { created_at: 1 });
    const muteList: MuteEntry[] = [];
    const hidden: string[] = [];

    const r1 = selectFriendsFeedNotes(
      makeState({ entities: { a, b }, noteIds: ["a", "b"], muteList, hiddenPubkeys: hidden }),
    );
    const r2 = selectFriendsFeedNotes(
      makeState({
        entities: { a, b, x: note("x", { created_at: 99 }) },
        noteIds: ["a", "b"],
        muteList,
        hiddenPubkeys: hidden,
      }),
    );
    expect(r2).toBe(r1); // same reference → the feed does not re-render
  });

  it("keeps the same reference when the mute list is replaced by an equivalent array", () => {
    const a = note("a");
    const r1 = selectFriendsFeedNotes(
      makeState({
        entities: { a },
        noteIds: ["a"],
        muteList: [{ type: "pubkey", value: "mallory" }],
      }),
    );
    const r2 = selectFriendsFeedNotes(
      makeState({
        entities: { a },
        noteIds: ["a"],
        muteList: [{ type: "pubkey", value: "mallory" }],
      }),
    );
    expect(r2).toBe(r1);
  });

  it("returns a new, larger result after unmuting (events were never dropped from the index)", () => {
    const a = note("a", { pubkey: "alice" });
    const m = note("m", { pubkey: "mallory" });
    const entities = { a, m };
    const noteIds = ["a", "m"];

    const muted = selectFriendsFeedNotes(
      makeState({ entities, noteIds, muteList: [{ type: "pubkey", value: "mallory" }] }),
    );
    expect(muted.map((n) => n.id)).toEqual(["a"]);

    const unmuted = selectFriendsFeedNotes(makeState({ entities, noteIds, muteList: [] }));
    expect(unmuted.map((n) => n.id)).toEqual(["a", "m"]);
  });
});
