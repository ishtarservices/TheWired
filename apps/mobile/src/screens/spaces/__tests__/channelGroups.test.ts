import { buildChannelRows, nativeChatChannel } from "../channelGroups";
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

describe("buildChannelRows", () => {
  it("emits ungrouped channels first, then category headers + members", () => {
    const rows = buildChannelRows(
      [
        channel({ id: "a", categoryId: null }),
        channel({ id: "b", categoryId: "Community" }),
        channel({ id: "c", categoryId: "Community" }),
        channel({ id: "d", categoryId: "Media", type: "media" }),
      ],
      "platform",
    );
    expect(rows.map((r) => r.key)).toEqual(["a", "cat-Community", "b", "c", "cat-Media", "d"]);
  });

  it("returns nothing while channels are still loading", () => {
    expect(buildChannelRows(null, "nip29")).toEqual([]);
  });

  it("synthesizes the single chat for empty nip29 spaces only", () => {
    const rows = buildChannelRows([], "nip29");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "channel", channel: nativeChatChannel() });
    expect(buildChannelRows([], "platform")).toEqual([]);
  });
});
