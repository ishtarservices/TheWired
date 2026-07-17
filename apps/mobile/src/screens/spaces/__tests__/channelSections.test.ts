import { buildChannelSections } from "../channelSections";
import { nativeChatChannel } from "../channelGroups";
import { selectLiveItems, type LiveItem } from "../liveItems";
import type { RootState } from "@/store";
import type { SpaceChannel } from "@/lib/api/spaces";

const channel = (over: Partial<SpaceChannel>): SpaceChannel => ({
  id: "c",
  type: "chat",
  label: "chat",
  isDefault: false,
  categoryId: null,
  position: 0,
  adminOnly: false,
  slowModeSeconds: 0,
  feedMode: "all",
  ...over,
});

const live = (over: Partial<LiveItem>): LiveItem => ({
  id: "l1",
  kind: "voice",
  channelId: null,
  label: "voice-lounge",
  participantPubkeys: [],
  ...over,
});

describe("buildChannelSections", () => {
  it("returns nothing while channels are still loading", () => {
    expect(buildChannelSections(null, "platform", [])).toEqual([]);
  });

  it("groups by type in fixed order: text → music → feeds, headers only when non-empty", () => {
    const rows = buildChannelSections(
      [
        channel({ id: "general", type: "chat" }),
        channel({ id: "clips", type: "media" }),
        channel({ id: "releases", type: "music" }),
        channel({ id: "feedback", type: "chat" }),
        channel({ id: "essays", type: "articles" }),
      ],
      "platform",
      [],
    );
    expect(rows.map((r) => r.key)).toEqual([
      "hdr-text",
      "general",
      "feedback",
      "hdr-music",
      "releases",
      "hdr-feeds",
      "clips",
      "essays",
    ]);
    expect(rows.find((r) => r.key === "releases")?.kind).toBe("musicChannel");
  });

  it("omits every header for an empty channel list", () => {
    expect(buildChannelSections([], "platform", [])).toEqual([]);
  });

  it("renders the live section first, and only when items exist", () => {
    const rows = buildChannelSections(
      [channel({ id: "general" })],
      "platform",
      [live({ id: "v1" })],
    );
    expect(rows.map((r) => r.key)).toEqual(["hdr-live", "live-v1", "hdr-text", "general"]);
    const without = buildChannelSections([channel({ id: "general" })], "platform", []);
    expect(without.some((r) => r.kind === "live" || r.key === "hdr-live")).toBe(false);
  });

  it("synthesizes the single chat for empty nip29 spaces only", () => {
    const rows = buildChannelSections([], "nip29", []);
    expect(rows.map((r) => r.key)).toEqual(["hdr-text", "chat"]);
    expect(rows[1]).toMatchObject({ kind: "channel", channel: nativeChatChannel() });
    expect(buildChannelSections([], "platform", [])).toEqual([]);
  });

  it("unknown and future types land in feeds as non-enterable rows", () => {
    const rows = buildChannelSections(
      [channel({ id: "stage", type: "voice" }), channel({ id: "mystery", type: "hologram" })],
      "platform",
      [],
    );
    expect(rows.map((r) => r.key)).toEqual(["hdr-feeds", "stage", "mystery"]);
    for (const row of rows.slice(1)) {
      expect(row).toMatchObject({ kind: "channel", enterable: false });
    }
  });
});

describe("selectLiveItems", () => {
  it("returns an empty, referentially stable list (no live sources yet)", () => {
    const state = {} as RootState;
    const a = selectLiveItems(state, "space-a");
    const b = selectLiveItems(state, "space-b");
    expect(a).toEqual([]);
    expect(a).toBe(b);
  });
});
