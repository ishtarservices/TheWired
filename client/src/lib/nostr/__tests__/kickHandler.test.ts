import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addEvent } from "@/store/slices/eventsSlice";
import { addSpace } from "@/store/slices/spacesSlice";
import { setMembers } from "@/store/slices/spaceConfigSlice";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceMember } from "@/types/space";

vi.mock("@/lib/api/roles", () => ({
  fetchAllMemberRoles: vi.fn(),
}));
vi.mock("@/lib/nostr/groupSubscriptions", () => ({
  enterClientSpace: vi.fn(),
  leaveClientSpace: vi.fn(),
  switchSpaceChannel: vi.fn(),
  openBgChatSub: vi.fn(),
  closeBgChatSub: vi.fn(),
  enterFriendsFeed: vi.fn(),
  leaveFriendsFeed: vi.fn(),
  switchFriendsFeedChannel: vi.fn(),
}));
vi.mock("@/lib/db/spaceStore", () => ({
  removeSpaceFromStore: vi.fn(),
  addSpaceToStore: vi.fn(),
  updateSpaceInStore: vi.fn(),
  loadSpaces: vi.fn().mockResolvedValue([]),
  saveSpaces: vi.fn(),
}));
vi.mock("@/lib/db/spaceMembersStore", () => ({
  removeMembers: vi.fn().mockResolvedValue(undefined),
  saveMembers: vi.fn().mockResolvedValue(undefined),
  loadAllMembers: vi.fn().mockResolvedValue({}),
  loadMembers: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/lastChannelCache", () => ({
  removeLastChannel: vi.fn(),
  getLastChannel: vi.fn(),
  setLastChannel: vi.fn(),
}));

import * as rolesApi from "@/lib/api/roles";
import { _resetInFlight } from "@/store/thunks/spaceMembers";
import { handlePotentialKick } from "../kickHandler";

const mockFetchRoles = rolesApi.fetchAllMemberRoles as ReturnType<typeof vi.fn>;

const ME = "a".repeat(64);
const SPACE_ID = "space-kick-1";
const EVENT_ID = "deadbeef" + "0".repeat(56);

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: EVENT_ID,
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: 9,
    tags: [["h", SPACE_ID]],
    content: "hello",
    sig: "f".repeat(128),
    ...overrides,
  };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: SPACE_ID,
    name: "My Space",
    hostRelay: "wss://relay.test",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [ME],
    feedPubkeys: [],
    creatorPubkey: "b".repeat(64),
    createdAt: 1_000_000,
    ...overrides,
  };
}

function makeMember(pubkey: string): SpaceMember {
  return { pubkey, roles: [], joinedAt: 1_000_000 };
}

beforeEach(() => {
  store.dispatch(resetAll());
  _resetInFlight();
  mockFetchRoles.mockReset();
});

describe("handlePotentialKick", () => {
  it("ignores success=true OK responses (publish accepted)", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));

    await handlePotentialKick(EVENT_ID, true, "");

    expect(mockFetchRoles).not.toHaveBeenCalled();
    expect(store.getState().spaces.list).toHaveLength(1);
  });

  it("ignores rejections that aren't the membership-gate reason", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));

    // Generic relay errors must NOT trigger cleanup. NIP-42 pre-AUTH challenges
    // come back as "auth-required: " too; ensure those aren't misread as kicks.
    await handlePotentialKick(EVENT_ID, false, "auth-required: please authenticate first");
    await handlePotentialKick(EVENT_ID, false, "rate-limited: too many events");
    await handlePotentialKick(EVENT_ID, false, "blocked: spam content");

    expect(mockFetchRoles).not.toHaveBeenCalled();
    expect(store.getState().spaces.list).toHaveLength(1);
  });

  it("no-op if the rejected event isn't in our local store", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addSpace(makeSpace()));
    // No addEvent — we can't resolve the event → no-op.

    await handlePotentialKick(EVENT_ID, false, "auth-required: not a member of this group");

    expect(mockFetchRoles).not.toHaveBeenCalled();
    expect(store.getState().spaces.list).toHaveLength(1);
  });

  it("no-op if the event has no h-tag (not space-scoped)", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent({ tags: [["p", "someone"]] })));
    store.dispatch(addSpace(makeSpace()));

    await handlePotentialKick(EVENT_ID, false, "auth-required: not a member of this group");

    expect(mockFetchRoles).not.toHaveBeenCalled();
    expect(store.getState().spaces.list).toHaveLength(1);
  });

  it("no-op if not logged in", async () => {
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));
    // identity.pubkey is null

    await handlePotentialKick(EVENT_ID, false, "auth-required: not a member of this group");

    expect(mockFetchRoles).not.toHaveBeenCalled();
    expect(store.getState().spaces.list).toHaveLength(1);
  });

  it("REGRESSION: backend confirms we're kicked → space removed and notification posted", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setMembers({ spaceId: SPACE_ID, members: [makeMember(ME)] }));

    // Server confirms: we're no longer a member.
    mockFetchRoles.mockResolvedValue([makeMember("someone-else")]);

    await handlePotentialKick(
      EVENT_ID,
      false,
      "auth-required: not a member of this group",
    );

    // Space removed from Redux + notification dispatched.
    const state = store.getState();
    expect(state.spaces.list.find((s) => s.id === SPACE_ID)).toBeUndefined();

    const kickNotif = state.notifications.notifications.find(
      (n) => n.title === "Removed from space",
    );
    expect(kickNotif).toBeDefined();
    expect(kickNotif?.body).toContain("My Space");
  });

  it("does NOT remove the space if the server still says we're a member (rare race)", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setMembers({ spaceId: SPACE_ID, members: [makeMember(ME)] }));

    // Server says we're still a member — must not act on a stale rejection.
    mockFetchRoles.mockResolvedValue([makeMember(ME), makeMember("someone-else")]);

    await handlePotentialKick(
      EVENT_ID,
      false,
      "auth-required: not a member of this group",
    );

    expect(store.getState().spaces.list.find((s) => s.id === SPACE_ID)).toBeDefined();
  });

  it("acts on rejection even when membership API errors (defaults to removal)", async () => {
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(addSpace(makeSpace()));
    // No setMembers → spaceConfig.members[SPACE_ID] is undefined.
    mockFetchRoles.mockRejectedValue(new Error("network"));

    await handlePotentialKick(
      EVENT_ID,
      false,
      "auth-required: not a member of this group",
    );

    // Without a membership list to verify, treat the rejection as authoritative
    // (nothing in spaceConfig.members[SPACE_ID] confirms we're still in).
    expect(store.getState().spaces.list.find((s) => s.id === SPACE_ID)).toBeUndefined();
  });
});
