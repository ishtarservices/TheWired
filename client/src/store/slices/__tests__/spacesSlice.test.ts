import { describe, it, expect } from "vitest";
import { spacesSlice } from "../spacesSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import type { Space } from "@/types/space";

const {
  setSpaces,
  addSpace,
  removeSpace,
  updateSpace,
  setActiveSpace,
  setActiveChannel,
  setChannels,
  addChannelToList,
  updateChannelInList,
  removeChannelFromList,
  addPendingInvite,
  removePendingInvite,
  clearSpacePendingInvites,
  updateSpaceFeedSources,
  updateSpaceMembers,
} = spacesSlice.actions;

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Test Space",
    hostRelay: "wss://relay.test.com",
    mode: "read-write" as const,
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: "a".repeat(64),
    createdAt: 1000000,
    ...overrides,
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    spaceId: "space-1",
    type: "chat",
    label: "general",
    position: 0,
    isDefault: true,
    adminOnly: false,
    slowModeSeconds: 0,
    ...overrides,
  };
}

describe("spacesSlice", () => {
  // ─── setSpaces ─────────────────────────────────

  it("replaces entire spaces list", () => {
    const store = createTestStore();
    const spaces = [makeSpace(), makeSpace({ id: "space-2", name: "Two" })];
    store.dispatch(setSpaces(spaces));
    expect(store.getState().spaces.list).toHaveLength(2);
  });

  // ─── addSpace ──────────────────────────────────

  it("adds a new space", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    expect(store.getState().spaces.list).toHaveLength(1);
    expect(store.getState().spaces.list[0].name).toBe("Test Space");
  });

  it("upserts existing space by id", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(addSpace(makeSpace({ name: "Updated" })));
    expect(store.getState().spaces.list).toHaveLength(1);
    expect(store.getState().spaces.list[0].name).toBe("Updated");
  });

  // ─── removeSpace ───────────────────────────────

  it("removes a space", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(removeSpace("space-1"));
    expect(store.getState().spaces.list).toHaveLength(0);
  });

  it("clears activeSpaceId and activeChannelId when active space removed", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setActiveSpace("space-1"));
    store.dispatch(setActiveChannel("ch-1"));
    store.dispatch(removeSpace("space-1"));
    expect(store.getState().spaces.activeSpaceId).toBeNull();
    expect(store.getState().spaces.activeChannelId).toBeNull();
  });

  it("clears channels and loading state for removed space", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setChannels({ spaceId: "space-1", channels: [makeChannel()] as any }));
    store.dispatch(removeSpace("space-1"));
    expect(store.getState().spaces.channels["space-1"]).toBeUndefined();
  });

  // ─── updateSpace ───────────────────────────────

  it("updates an existing space", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(updateSpace(makeSpace({ name: "Renamed" })));
    expect(store.getState().spaces.list[0].name).toBe("Renamed");
  });

  // ─── setActiveSpace / setActiveChannel ─────────

  it("sets active space and channel", () => {
    const store = createTestStore();
    store.dispatch(setActiveSpace("space-1"));
    store.dispatch(setActiveChannel("ch-1"));
    expect(store.getState().spaces.activeSpaceId).toBe("space-1");
    expect(store.getState().spaces.activeChannelId).toBe("ch-1");
  });

  it("can clear active space to null", () => {
    const store = createTestStore();
    store.dispatch(setActiveSpace("space-1"));
    store.dispatch(setActiveSpace(null));
    expect(store.getState().spaces.activeSpaceId).toBeNull();
  });

  // ─── Channel management ────────────────────────

  it("sets channels for a space", () => {
    const store = createTestStore();
    const channels = [makeChannel(), makeChannel({ id: "ch-2", label: "random" })];
    store.dispatch(setChannels({ spaceId: "space-1", channels: channels as any }));
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(2);
  });

  it("adds a channel to a space", () => {
    const store = createTestStore();
    store.dispatch(addChannelToList(makeChannel() as any));
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(1);
  });

  it("creates the array if space has no channels yet", () => {
    const store = createTestStore();
    store.dispatch(addChannelToList(makeChannel({ spaceId: "new-space" }) as any));
    expect(store.getState().spaces.channels["new-space"]).toHaveLength(1);
  });

  it("updates a channel in a space", () => {
    const store = createTestStore();
    store.dispatch(addChannelToList(makeChannel() as any));
    store.dispatch(
      updateChannelInList(makeChannel({ label: "renamed" }) as any),
    );
    expect(store.getState().spaces.channels["space-1"][0].label).toBe("renamed");
  });

  it("removes a channel from a space", () => {
    const store = createTestStore();
    store.dispatch(addChannelToList(makeChannel() as any));
    store.dispatch(removeChannelFromList({ spaceId: "space-1", channelId: "ch-1" }));
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(0);
  });

  // ─── Pending invites ──────────────────────────

  it("adds a pending invite", () => {
    const store = createTestStore();
    store.dispatch(
      addPendingInvite({
        code: "abc123",
        spaceId: "space-1",
        timestamp: Date.now(),
      }),
    );
    expect(store.getState().spaces.pendingInvites).toHaveLength(1);
  });

  it("deduplicates pending invites by code", () => {
    const store = createTestStore();
    const invite = { code: "abc123", spaceId: "space-1", timestamp: Date.now() };
    store.dispatch(addPendingInvite(invite));
    store.dispatch(addPendingInvite(invite));
    expect(store.getState().spaces.pendingInvites).toHaveLength(1);
  });

  it("removes a pending invite by code", () => {
    const store = createTestStore();
    store.dispatch(
      addPendingInvite({ code: "abc123", spaceId: "space-1", timestamp: 0 }),
    );
    store.dispatch(removePendingInvite("abc123"));
    expect(store.getState().spaces.pendingInvites).toHaveLength(0);
  });

  it("clears all pending invites for a space", () => {
    const store = createTestStore();
    store.dispatch(
      addPendingInvite({ code: "a", spaceId: "space-1", timestamp: 0 }),
    );
    store.dispatch(
      addPendingInvite({ code: "b", spaceId: "space-1", timestamp: 0 }),
    );
    store.dispatch(
      addPendingInvite({ code: "c", spaceId: "space-2", timestamp: 0 }),
    );
    store.dispatch(clearSpacePendingInvites("space-1"));
    expect(store.getState().spaces.pendingInvites).toHaveLength(1);
    expect(store.getState().spaces.pendingInvites[0].code).toBe("c");
  });

  // ─── Feed sources / members ────────────────────

  it("updates space feed sources", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(
      updateSpaceFeedSources({ spaceId: "space-1", pubkeys: ["pk1", "pk2"] }),
    );
    expect(store.getState().spaces.list[0].feedPubkeys).toEqual(["pk1", "pk2"]);
  });

  it("updates space members", () => {
    const store = createTestStore();
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(
      updateSpaceMembers({ spaceId: "space-1", members: ["pk1"] }),
    );
    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["pk1"]);
  });
});
