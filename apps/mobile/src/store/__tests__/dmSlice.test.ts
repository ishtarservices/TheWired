import {
  dmSlice,
  dmMessageReceived,
  dmSendStarted,
  dmSendResolved,
  dmHydrated,
  dmConversationRemoved,
  dmCleared,
  setActiveDMConversation,
  type DMMessage,
} from "../slices/dmSlice";

const ME = "a".repeat(64);
const PEER = "b".repeat(64);

function msg(over: Partial<DMMessage> = {}): DMMessage {
  const wrapId = over.wrapId ?? `wrap-${Math.random().toString(36).slice(2)}`;
  return {
    id: wrapId,
    senderPubkey: PEER,
    content: "hello",
    createdAt: 1000,
    wrapId,
    rumorId: "r1",
    ...over,
  };
}

const reduce = dmSlice.reducer;
type State = ReturnType<typeof reduce>;

function receive(state: State | undefined, message: DMMessage, partner = PEER): State {
  return reduce(state, dmMessageReceived({ partnerPubkey: partner, myPubkey: ME, message }));
}

describe("dmSlice", () => {
  it("adds an incoming message, creates the conversation, bumps unread", () => {
    const state = receive(undefined, msg({ content: "hey", createdAt: 5 }));
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      pubkey: PEER,
      lastMessageAt: 5,
      lastMessagePreview: "hey",
      unreadCount: 1,
    });
    expect(state.messages[PEER]).toHaveLength(1);
  });

  it("dedups by wrap id (relay echo of a processed wrap is a no-op)", () => {
    const m = msg();
    let state = receive(undefined, m);
    state = receive(state, m);
    expect(state.messages[PEER]).toHaveLength(1);
    expect(state.conversations[0].unreadCount).toBe(1);
  });

  it("does not count own messages or active-conversation messages as unread", () => {
    let state = receive(undefined, msg({ senderPubkey: ME, wrapId: "w-own" }));
    expect(state.conversations[0].unreadCount).toBe(0);

    state = reduce(state, setActiveDMConversation(PEER));
    state = receive(state, msg({ wrapId: "w-in-view" }));
    expect(state.conversations[0].unreadCount).toBe(0);
  });

  it("opening a conversation clears its unread count", () => {
    let state = receive(undefined, msg());
    expect(state.conversations[0].unreadCount).toBe(1);
    state = reduce(state, setActiveDMConversation(PEER));
    expect(state.conversations[0].unreadCount).toBe(0);
  });

  it("keeps messages sorted by createdAt and conversations by recency", () => {
    const other = "c".repeat(64);
    let state = receive(undefined, msg({ wrapId: "w1", createdAt: 100 }));
    state = receive(state, msg({ wrapId: "w2", createdAt: 50 }));
    state = receive(state, msg({ wrapId: "w3", createdAt: 200, senderPubkey: other }), other);
    expect(state.messages[PEER].map((m) => m.createdAt)).toEqual([50, 100]);
    expect(state.conversations.map((c) => c.pubkey)).toEqual([other, PEER]);
  });

  it("send lifecycle: pending → sent (and failed)", () => {
    let state = reduce(
      undefined,
      dmSendStarted({ partnerPubkey: PEER, message: msg({ senderPubkey: ME, wrapId: "self1" }) }),
    );
    expect(state.messages[PEER][0].status).toBe("pending");

    state = reduce(state, dmSendResolved({ partnerPubkey: PEER, wrapId: "self1", ok: true }));
    expect(state.messages[PEER][0].status).toBe("sent");

    let failed = reduce(
      undefined,
      dmSendStarted({ partnerPubkey: PEER, message: msg({ senderPubkey: ME, wrapId: "self2" }) }),
    );
    failed = reduce(failed, dmSendResolved({ partnerPubkey: PEER, wrapId: "self2", ok: false }));
    expect(failed.messages[PEER][0].status).toBe("failed");
  });

  it("hydration rebuilds conversations, scrubs ciphertext, fails stale pendings", () => {
    const state = reduce(
      undefined,
      dmHydrated({
        messagesByPeer: {
          [PEER]: [
            msg({ wrapId: "w1", createdAt: 10, content: "real" }),
            msg({ wrapId: "w2", createdAt: 20, content: "QUJDRA==".repeat(10) }), // base64 junk
            msg({ wrapId: "w3", createdAt: 30, content: "mine", senderPubkey: ME, status: "pending" }),
          ],
        },
      }),
    );
    const restored = state.messages[PEER];
    expect(restored.map((m) => m.wrapId)).toEqual(["w1", "w3"]);
    expect(restored[1].status).toBe("failed"); // pending never resolves after relaunch
    expect(state.conversations[0]).toMatchObject({ pubkey: PEER, unreadCount: 0 });
    expect(state.hydrated).toBe(true);

    // A live redelivery of a restored wrap is deduped.
    const after = receive(state, msg({ wrapId: "w1", createdAt: 10, content: "real" }));
    expect(after.messages[PEER]).toHaveLength(2);
  });

  it("removes a conversation and clears everything on dmCleared", () => {
    let state = receive(undefined, msg());
    state = reduce(state, dmConversationRemoved(PEER));
    expect(state.conversations).toHaveLength(0);
    expect(state.messages[PEER]).toBeUndefined();

    state = receive(state, msg({ wrapId: "w9" }));
    state = reduce(state, dmCleared());
    expect(state.conversations).toHaveLength(0);
    expect(state.processedWrapIds).toHaveLength(0);
  });
});
