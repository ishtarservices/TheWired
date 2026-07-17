import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { NostrEvent, NostrFilter } from "@thewired/shared-types";

import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters } from "@/core/adapters";
import type { AppDispatch, RootState } from "@/store";
import type { RelayPool } from "../relayPool";
import {
  attributeChannel,
  buildSignalFilters,
  createSpaceSignal,
  directoryFromChannels,
  partitionByHost,
  SIGNAL_BACKLOG_SEC,
  SIGNAL_LIMIT,
  SPACE_SIGNAL_SUB,
} from "../spaceSignal";
import { verifyEventSync } from "../verifyEvent";
import type { SpaceChannel } from "@/lib/api/spaces";

const APP_RELAY = "wss://relay.test";
const SPACE = "space-1";

const mySecret = generateSecretKey();
const myPubkey = getPublicKey(mySecret);
const peerSecret = generateSecretKey();
const peerPubkey = getPublicKey(peerSecret);

function chatEvent(
  content: string,
  tags: string[][],
  secret: Uint8Array = peerSecret,
  created_at = 1_700_000_000,
): NostrEvent {
  return finalizeEvent({ kind: 9, created_at, tags, content }, secret);
}

function channel(over: Partial<SpaceChannel> & { id: string }): SpaceChannel {
  return {
    type: "chat",
    label: over.id,
    isDefault: false,
    categoryId: null,
    position: 0,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...over,
  };
}

interface PoolCall {
  type: "subscribe" | "unsubscribe";
  subId: string;
  filters?: NostrFilter[];
  urls?: string[];
}

function makeHarness(opts: { signer?: boolean; muted?: string[] } = {}) {
  const calls: PoolCall[] = [];
  const pool = {
    subscribe(subId: string, filters: NostrFilter[], urls?: string[]) {
      calls.push({ type: "subscribe", subId, filters, urls });
    },
    unsubscribe(subId: string) {
      calls.push({ type: "unsubscribe", subId });
    },
  } as unknown as RelayPool;

  const dispatched: Array<{ type: string; payload: unknown }> = [];
  const dispatch = ((action: { type: string; payload: unknown }) => {
    dispatched.push(action);
    return action;
  }) as unknown as AppDispatch;

  const mutedPubkeys: Record<string, true> = {};
  for (const pk of opts.muted ?? []) mutedPubkeys[pk] = true;
  const getState = () =>
    ({
      moderation: { mutedPubkeys },
      identity: { pubkey: myPubkey },
    }) as unknown as RootState;

  const adapters = {
    verifier: { verify: async (event: NostrEvent) => verifyEventSync(event) },
    signer: (opts.signer ?? true) ? new LocalNsecSigner(mySecret) : null,
  } as unknown as PlatformAdapters;

  // Directory source (ensureSpaceMeta in production) — rejects on failure.
  const fetchChannelDirectory = jest.fn<Promise<SpaceChannel[]>, [string]>();

  const signal = createSpaceSignal({
    adapters,
    dispatch,
    getState,
    pool,
    appRelayUrl: APP_RELAY,
    fetchChannelDirectory,
  });
  return { signal, calls, dispatched, fetchChannelDirectory };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 80));

function batches(dispatched: Array<{ type: string; payload: unknown }>) {
  return dispatched
    .filter((a) => a.type === "spacePreviews/channelPreviewsUpserted")
    .map((a) => a.payload as Array<Record<string, unknown>>);
}

describe("partitionByHost", () => {
  it("collapses loopback aliases — dev seeds say localhost, the app relay says 127.0.0.1", () => {
    const { appRelay, foreign } = partitionByHost(
      [
        { spaceId: "a", hostRelay: "ws://localhost:7777" },
        { spaceId: "b", hostRelay: "ws://127.0.0.1:7777" },
        { spaceId: "c", hostRelay: "ws://localhost:9999" }, // different port = foreign
      ],
      "ws://127.0.0.1:7777",
    );
    expect(appRelay).toEqual(["a", "b"]);
    expect([...foreign.keys()]).toEqual(["ws://127.0.0.1:9999"]);
  });


  it("treats null and normalized-equal hostRelays as the app relay", () => {
    const { appRelay, foreign } = partitionByHost(
      [
        { spaceId: "a", hostRelay: null },
        { spaceId: "b", hostRelay: "wss://relay.test/" },
        { spaceId: "c", hostRelay: "wss://elsewhere.example" },
        { spaceId: "d", hostRelay: "wss://elsewhere.example/" },
      ],
      APP_RELAY,
    );
    expect(appRelay).toEqual(["a", "b"]);
    expect([...foreign.keys()]).toEqual(["wss://elsewhere.example"]);
    expect(foreign.get("wss://elsewhere.example")).toEqual(["c", "d"]);
  });
});

describe("buildSignalFilters", () => {
  const NOW = 1_700_000_000;

  it("returns no filters for an empty set", () => {
    expect(buildSignalFilters([], null, NOW)).toEqual([]);
  });

  it("cold start: one multi-space filter with the 48h floor", () => {
    const filters = buildSignalFilters(["a", "b"], null, NOW);
    expect(filters).toEqual([
      {
        kinds: [9],
        "#h": ["a", "b"],
        since: NOW - SIGNAL_BACKLOG_SEC,
        limit: SIGNAL_LIMIT,
      },
    ]);
  });

  it("resubscribe: watermark minus overlap, clamped to the floor", () => {
    const [withMark] = buildSignalFilters(["a"], NOW - 100, NOW);
    expect(withMark.since).toBe(NOW - 160);
    const [clamped] = buildSignalFilters(["a"], NOW - SIGNAL_BACKLOG_SEC * 2, NOW);
    expect(clamped.since).toBe(NOW - SIGNAL_BACKLOG_SEC);
  });
});

describe("directoryFromChannels / attributeChannel", () => {
  it("default = flagged chat channel, else first chat, else \"chat\"", () => {
    expect(
      directoryFromChannels([
        channel({ id: "a" }),
        channel({ id: "b", isDefault: true }),
      ]).defaultChannelId,
    ).toBe("b");
    expect(directoryFromChannels([channel({ id: "a" })]).defaultChannelId).toBe("a");
    // nip29 empty list — nativeChatChannel's id.
    const empty = directoryFromChannels([]);
    expect(empty.defaultChannelId).toBe("chat");
    expect(empty.channelIds.has("chat")).toBe(true);
  });

  it("routes tags, drops unknown tags once a directory exists, defaults untagged", () => {
    const dir = directoryFromChannels([channel({ id: "general", isDefault: true })]);
    const tagged = chatEvent("x", [["h", SPACE], ["channel", "general"]]);
    const hostile = chatEvent("x", [["h", SPACE], ["channel", "not-a-channel"]]);
    const untagged = chatEvent("x", [["h", SPACE]]);
    expect(attributeChannel(tagged, dir)).toBe("general");
    expect(attributeChannel(hostile, dir)).toBeNull();
    expect(attributeChannel(untagged, dir)).toBe("general");
    // No directory: tags pass through, untagged waits.
    expect(attributeChannel(tagged, null)).toBe("general");
    expect(attributeChannel(untagged, null)).toBeNull();
  });
});

describe("space signal", () => {
  it("subscribes once per set change, targeted at the app relay only", () => {
    const { signal, calls } = makeHarness();
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]); // identical → no-op
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: "subscribe",
      subId: SPACE_SIGNAL_SUB,
      urls: [APP_RELAY],
    });
    expect(calls[0].filters![0]).toMatchObject({ kinds: [9], "#h": [SPACE] });

    signal.setSpaces([
      { spaceId: SPACE, hostRelay: null },
      { spaceId: "space-2", hostRelay: null },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1].filters![0]["#h"]).toEqual([SPACE, "space-2"]);
  });

  it("ignores foreign-hostRelay spaces (P1 scope) and closes on empty set", () => {
    const { signal, calls } = makeHarness();
    signal.setSpaces([
      { spaceId: SPACE, hostRelay: null },
      { spaceId: "far", hostRelay: "wss://elsewhere.example" },
    ]);
    expect(calls[0].filters![0]["#h"]).toEqual([SPACE]);
    signal.setSpaces([{ spaceId: "far", hostRelay: "wss://elsewhere.example" }]);
    expect(calls[1]).toEqual({ type: "unsubscribe", subId: SPACE_SIGNAL_SUB });
  });

  it("never subscribes for guests (no signer, no NIP-42, relay serves nothing)", () => {
    const { signal, calls } = makeHarness({ signer: false });
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);
    expect(calls).toHaveLength(0);
  });

  it("routes verified tagged events into one batched dispatch with isOwn", async () => {
    const { signal, calls, dispatched } = makeHarness();
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);

    const theirs = chatEvent("hello", [["h", SPACE], ["channel", "general"]]);
    const mine = chatEvent("mine", [["h", SPACE], ["channel", "general"]], mySecret);
    const forged = { ...theirs, content: "tampered" };
    signal.handleEvent(theirs, APP_RELAY);
    signal.handleEvent(mine, APP_RELAY);
    signal.handleEvent(forged, APP_RELAY);
    await flush();

    const all = batches(dispatched).flat();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      spaceId: SPACE,
      channelId: "general",
      senderPubkey: peerPubkey,
      isOwn: false,
    });
    expect(all[1]).toMatchObject({ senderPubkey: myPubkey, isOwn: true });
    expect(calls.filter((c) => c.type === "subscribe")).toHaveLength(1);
  });

  it("drops events from other relays, other spaces, muted authors, and dupes", async () => {
    const { signal, dispatched } = makeHarness({ muted: [peerPubkey] });
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);

    const muted = chatEvent("muted", [["h", SPACE], ["channel", "c"]]);
    const wrongRelay = chatEvent("spoof", [["h", SPACE], ["channel", "c"]], mySecret);
    const wrongSpace = chatEvent("other", [["h", "not-joined"], ["channel", "c"]], mySecret);
    const ok = chatEvent("real", [["h", SPACE], ["channel", "c"]], mySecret);

    signal.handleEvent(muted, APP_RELAY);
    signal.handleEvent(wrongRelay, "wss://relay.damus.io");
    signal.handleEvent(wrongSpace, APP_RELAY);
    signal.handleEvent(ok, APP_RELAY);
    signal.handleEvent(ok, APP_RELAY); // dupe
    await flush();

    const all = batches(dispatched).flat();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ eventId: ok.id, content: "real" });
  });

  it("buffers untagged events until the channel directory resolves the default", async () => {
    const { signal, dispatched, fetchChannelDirectory } = makeHarness();
    fetchChannelDirectory.mockResolvedValue([
      channel({ id: "lounge", isDefault: true }),
      channel({ id: "dev" }),
    ]);
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);

    signal.handleEvent(chatEvent("untagged", [["h", SPACE]]), APP_RELAY);
    await flush();

    expect(fetchChannelDirectory).toHaveBeenCalledWith(SPACE);
    const all = batches(dispatched).flat();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ channelId: "lounge", content: "untagged" });

    // Directory now cached — hostile tags are dropped.
    signal.handleEvent(
      chatEvent("hostile", [["h", SPACE], ["channel", "nope"]], mySecret),
      APP_RELAY,
    );
    await flush();
    expect(batches(dispatched).flat()).toHaveLength(1);
  });

  it("drops the buffer when the directory fetch fails (retries on next arrival)", async () => {
    const { signal, dispatched, fetchChannelDirectory } = makeHarness();
    fetchChannelDirectory.mockRejectedValueOnce(new Error("backend down"));
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);

    signal.handleEvent(chatEvent("lost", [["h", SPACE]]), APP_RELAY);
    await flush();
    expect(batches(dispatched).flat()).toHaveLength(0);

    fetchChannelDirectory.mockResolvedValueOnce([
      channel({ id: "general", isDefault: true }),
    ]);
    signal.handleEvent(chatEvent("retry", [["h", SPACE]], mySecret), APP_RELAY);
    await flush();
    expect(batches(dispatched).flat()).toHaveLength(1);
  });

  it("re-REQs after AUTH (debounced) and with a watermark on resubscribe", async () => {
    const { signal, calls } = makeHarness();
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);
    const nowSec = Math.floor(Date.now() / 1000);
    signal.handleEvent(
      chatEvent("mark", [["h", SPACE], ["channel", "c"]], peerSecret, nowSec - 10),
      APP_RELAY,
    );
    await flush();

    signal.handleAuthed();
    signal.handleAuthed(); // debounced — one re-REQ
    await new Promise((resolve) => setTimeout(resolve, 500));
    const subs = calls.filter((c) => c.type === "subscribe");
    expect(subs).toHaveLength(2);
    // since advanced to watermark-60, far above the 48h floor
    expect(subs[1].filters![0].since).toBe(nowSec - 10 - 60);

    signal.resubscribe();
    expect(calls.filter((c) => c.type === "subscribe")).toHaveLength(3);
  });

  it("stop() closes the sub and clears the watermark and space set", async () => {
    const { signal, calls } = makeHarness();
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);
    signal.stop();
    expect(calls[calls.length - 1]).toEqual({
      type: "unsubscribe",
      subId: SPACE_SIGNAL_SUB,
    });
    signal.resubscribe(); // not subscribed — no-op
    expect(calls.filter((c) => c.type === "subscribe")).toHaveLength(1);
    // Same set again re-subscribes fresh (cold since).
    signal.setSpaces([{ spaceId: SPACE, hostRelay: null }]);
    const subs = calls.filter((c) => c.type === "subscribe");
    expect(subs).toHaveLength(2);
  });
});
