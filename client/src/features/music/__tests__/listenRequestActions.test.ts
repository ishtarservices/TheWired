import { describe, it, expect, vi } from "vitest";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import type { MusicProposal } from "@/types/music";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { login } from "@/store/slices/identitySlice";
import { addEvent } from "@/store/slices/eventsSlice";
import { addTrack, listenRequestsLoaded } from "@/store/slices/musicSlice";
import { parseTrackEvent } from "../trackParser";
import { createListenRequestActions, type ListenRequestDeps } from "../listenRequestActions";
import { collapseListenRequests } from "../listenRequestInbox";
import { parseStoredListenRequests, LISTEN_REQUEST_RECORD_TTL_SEC } from "../listenRequestStorage";

const ME = "a".repeat(64);
const REQ = "c".repeat(64);
const NOW = 1_800_000_000;
const TRACK_REF = `31683:${ME}:spiral`;

function trackEvent(tags: string[][], overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "e".repeat(63) + Math.floor(Math.random() * 10),
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: 31683,
    tags: [["d", "spiral"], ["title", "Spiral"], ...tags],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

function row(id: string, createdAt: number): MusicProposal {
  return {
    id,
    proposalId: "req-x",
    targetAlbum: TRACK_REF,
    proposerPubkey: REQ,
    ownerPubkey: ME,
    title: "listen request",
    changes: [{ type: "grant_access", role: "viewer" }],
    status: "open",
    createdAt,
  };
}

function makeDeps(overrides: Partial<ListenRequestDeps> = {}) {
  const published: { unsigned: UnsignedEvent; relays?: string[] }[] = [];
  const resolved: [string, string][] = [];
  let records = {};
  const deps: ListenRequestDeps = {
    fetchIncoming: vi.fn(async () => [row("r1", 100), row("r2", 200)]),
    resolve: vi.fn(async (id, status) => {
      resolved.push([id, status]);
      return "resolved" as const;
    }),
    publish: vi.fn(async (unsigned, relays) => {
      published.push({ unsigned, relays });
      return { ...unsigned, id: "f".repeat(64), sig: "0".repeat(128) };
    }),
    relaysFor: vi.fn(async () => ["wss://host.example"]),
    loadStoredEvent: vi.fn(async () => undefined),
    fetchLatest: vi.fn(async () => null),
    crypto: () => ({ decryptSelf: async () => "{}", encryptFor: async (r, p) => `enc:${r}:${p}` }),
    readRecords: vi.fn(() => records),
    writeRecords: vi.fn((_pk, r) => {
      records = { ...r };
    }),
    now: () => NOW,
    ...overrides,
  };
  return { deps, published, resolved, getRecords: () => records };
}

function storeWith(event?: NostrEvent) {
  const store = createTestStore();
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  if (event) {
    store.dispatch(addEvent(event));
    store.dispatch(addTrack(parseTrackEvent(event)));
  }
  return store;
}

describe("listen request actions", () => {
  it("grants a private track once and resolves every collapsed row", async () => {
    const event = trackEvent([["visibility", "private"]]);
    const store = storeWith(event);
    const { deps, published, resolved } = makeDeps();
    const actions = createListenRequestActions(deps);
    await actions.loadIncomingListenRequests()(store.dispatch, store.getState);
    const [group] = collapseListenRequests(store.getState().music.listenRequests.incoming, { me: ME });
    expect(group.rowIds).toEqual(["r2", "r1"]);

    const outcome = await actions.grantListenRequest(group)(store.dispatch, store.getState);
    expect(outcome).toBe("granted");
    expect(published).toHaveLength(1);
    expect(published[0].relays).toBeUndefined();
    expect(published[0].unsigned.tags[published[0].unsigned.tags.length - 1]).toEqual(["p", REQ, "", "collaborator"]);
    expect(resolved).toEqual([["r2", "accepted"], ["r1", "accepted"]]);
    expect(store.getState().music.listenRequests.incoming).toEqual([]);
  });

  it("silently settles a request whose target is public, without republishing", async () => {
    const store = storeWith(trackEvent([]));
    const { deps, published, resolved } = makeDeps();
    await createListenRequestActions(deps).loadIncomingListenRequests()(store.dispatch, store.getState);
    expect(published).toEqual([]);
    expect(resolved.map(([, s]) => s)).toEqual(["accepted", "accepted"]);
    expect(store.getState().music.listenRequests.incoming).toEqual([]);
  });

  it("is stale-gated unless forced", async () => {
    const store = storeWith();
    store.dispatch(listenRequestsLoaded({ rows: [], fetchedAt: NOW - 10 }));
    const { deps } = makeDeps();
    const actions = createListenRequestActions(deps);
    await actions.loadIncomingListenRequests()(store.dispatch, store.getState);
    expect(deps.fetchIncoming).not.toHaveBeenCalled();
    await actions.loadIncomingListenRequests(true)(store.dispatch, store.getState);
    expect(deps.fetchIncoming).toHaveBeenCalledTimes(1);
  });

  it("prefers a newer relay copy over the stored one when granting", async () => {
    const stale = trackEvent([["visibility", "private"]]);
    const fresh = trackEvent([["visibility", "private"], ["t", "added-on-phone"]], { created_at: stale.created_at + 100 });
    const store = storeWith(stale);
    const { deps, published } = makeDeps({ fetchLatest: async () => fresh });
    const actions = createListenRequestActions(deps);
    await actions.loadIncomingListenRequests()(store.dispatch, store.getState);
    const [group] = collapseListenRequests(store.getState().music.listenRequests.incoming, { me: ME });
    await actions.grantListenRequest(group)(store.dispatch, store.getState);
    expect(published[0].unsigned.tags).toContainEqual(["t", "added-on-phone"]);
  });

  it("refuses to grant a space-exclusive release to a non-member, and declines resolve rejected", async () => {
    const store = storeWith(trackEvent([["h", "space1"]]));
    const { deps, published, resolved } = makeDeps();
    const actions = createListenRequestActions(deps);
    await actions.loadIncomingListenRequests()(store.dispatch, store.getState);
    const [group] = collapseListenRequests(store.getState().music.listenRequests.incoming, { me: ME });
    await expect(actions.grantListenRequest(group)(store.dispatch, store.getState)).rejects.toThrow(/space exclusive/);
    expect(published).toEqual([]);
    await actions.declineListenRequest(group)(store.dispatch, store.getState);
    expect(resolved).toEqual([["r2", "rejected"], ["r1", "rejected"]]);
  });

  it("requester: publishes the request and remembers it per account", async () => {
    const store = createTestStore();
    store.dispatch(login({ pubkey: REQ, signerType: "nip07" }));
    const { deps, published, getRecords } = makeDeps();
    const actions = createListenRequestActions(deps);
    await actions.requestListenAccess(TRACK_REF)(store.dispatch, store.getState);
    expect(published[0].unsigned.kind).toBe(31685);
    expect(store.getState().music.listenRequests.requested[TRACK_REF]).toEqual({ requestedAt: NOW, eventId: "f".repeat(64) });
    expect(getRecords()).toEqual({ [TRACK_REF]: { requestedAt: NOW, eventId: "f".repeat(64) } });
    await actions.forgetListenAccessRequest(TRACK_REF)(store.dispatch, store.getState);
    expect(getRecords()).toEqual({});
  });
});

describe("parseStoredListenRequests", () => {
  it("drops malformed and expired records", () => {
    expect(
      parseStoredListenRequests(
        {
          ok: { requestedAt: NOW - 10, eventId: "x" },
          old: { requestedAt: NOW - LISTEN_REQUEST_RECORD_TTL_SEC - 1, eventId: "x" },
          bad: { requestedAt: "soon" },
          junk: 4,
        },
        NOW,
      ),
    ).toEqual({ ok: { requestedAt: NOW - 10, eventId: "x" } });
    expect(parseStoredListenRequests([], NOW)).toEqual({});
    expect(parseStoredListenRequests(null, NOW)).toEqual({});
  });
});
