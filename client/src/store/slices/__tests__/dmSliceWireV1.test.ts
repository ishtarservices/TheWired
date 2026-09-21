import { describe, it, expect } from "vitest";
import { dmSlice, isConversationFlagged, conversationExpireAfter, MUTED_FOREVER } from "../dmSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";

const {
  addDMMessage,
  setTyping,
  expireTyping,
  applyReceipt,
  applyReadStateRecord,
  setConversationFlag,
  setConversationExpireAfter,
  markDMSyncWarning,
  pruneExpiredDMs,
  upsertRoom,
  restoreDMState,
} = dmSlice.actions;

const ME = lunaVega.pubkey;
const PEER = riverChen.pubkey;
const R1 = "1".repeat(64);
const R2 = "2".repeat(64);

function seed(store: ReturnType<typeof createTestStore>) {
  store.dispatch(addDMMessage({ partnerPubkey: PEER, myPubkey: ME, message: { id: "a", senderPubkey: ME, content: "one", createdAt: 100, wrapId: "wa", rumorId: R1 } }));
  store.dispatch(addDMMessage({ partnerPubkey: PEER, myPubkey: ME, message: { id: "b", senderPubkey: ME, content: "two", createdAt: 200, wrapId: "wb", rumorId: R2, expiresAt: 500 } }));
}

describe("dmSlice — wire v1 additions", () => {
  it("typing hints expire", () => {
    const store = createTestStore();
    store.dispatch(setTyping({ conversationId: PEER, pubkey: PEER, until: 1000 }));
    expect(store.getState().dm.typing[PEER]).toEqual({ [PEER]: 1000 });
    store.dispatch(expireTyping(999));
    expect(store.getState().dm.typing[PEER]).toEqual({ [PEER]: 1000 });
    store.dispatch(expireTyping(1000));
    expect(store.getState().dm.typing[PEER]).toBeUndefined();
  });

  it("receipts mark delivered/read once per peer; read implies delivered; wrap dedup", () => {
    const store = createTestStore();
    seed(store);
    store.dispatch(applyReceipt({ conversationId: PEER, rumorIds: [R1], status: "delivered", from: PEER, wrapId: "rw1" }));
    store.dispatch(applyReceipt({ conversationId: PEER, rumorIds: [R1], status: "delivered", from: PEER, wrapId: "rw1" }));
    store.dispatch(applyReceipt({ conversationId: PEER, rumorIds: [R1, R2], status: "read", from: PEER, wrapId: "rw2" }));
    const [m1, m2] = store.getState().dm.messages[PEER];
    expect(m1.deliveredTo).toEqual([PEER]);
    expect(m1.readBy).toEqual([PEER]);
    expect(m2.deliveredTo).toEqual([PEER]);
    expect(m2.readBy).toEqual([PEER]);
  });

  it("flags: pin / archive / mute with LWW merge against a remote record", () => {
    const store = createTestStore();
    store.dispatch(setConversationFlag({ field: "pinned", conversationId: PEER, on: true, now: 1000 }));
    store.dispatch(setConversationFlag({ field: "muted", conversationId: PEER, on: true, now: 1000 }));
    let flags = store.getState().dm.flags;
    expect(isConversationFlagged(flags, "pinned", PEER, 1001)).toBe(true);
    expect(isConversationFlagged(flags, "muted", PEER, 1001)).toBe(true);
    expect(flags.muted[PEER]).toBe(MUTED_FOREVER);

    // Another device unpinned later (tombstone at 2000) and set a 1-day timer.
    store.dispatch(
      applyReadStateRecord({
        v: 2,
        lastRead: { [PEER]: 50 },
        pinned: { [PEER]: -2000 },
        archived: {},
        muted: {},
        expireAfter: { [PEER]: { s: 86400, at: 1500 } },
        updatedAt: 2000,
      }),
    );
    flags = store.getState().dm.flags;
    expect(isConversationFlagged(flags, "pinned", PEER, 2001)).toBe(false);
    expect(isConversationFlagged(flags, "muted", PEER, 2001)).toBe(true); // untouched by the merge
    expect(conversationExpireAfter(flags, PEER)).toBe(86400);
    expect(store.getState().dm.lastReadTimestamps[PEER]).toBe(50);

    // A local set after the tombstone wins again.
    store.dispatch(setConversationFlag({ field: "pinned", conversationId: PEER, on: true, now: 3000 }));
    expect(isConversationFlagged(store.getState().dm.flags, "pinned", PEER, 3001)).toBe(true);
    store.dispatch(setConversationExpireAfter({ conversationId: PEER, seconds: 0, now: 3000 }));
    expect(conversationExpireAfter(store.getState().dm.flags, PEER)).toBe(0);
  });

  it("sync warning toggles per message and expired messages are pruned", () => {
    const store = createTestStore();
    seed(store);
    store.dispatch(markDMSyncWarning({ partnerPubkey: PEER, wrapId: "wa", warning: true }));
    expect(store.getState().dm.messages[PEER][0].syncWarning).toBe(true);
    store.dispatch(markDMSyncWarning({ partnerPubkey: PEER, wrapId: "wa", warning: false }));
    expect(store.getState().dm.messages[PEER][0].syncWarning).toBeUndefined();

    store.dispatch(pruneExpiredDMs(499));
    expect(store.getState().dm.messages[PEER]).toHaveLength(2);
    store.dispatch(pruneExpiredDMs(500));
    expect(store.getState().dm.messages[PEER].map((m) => m.wrapId)).toEqual(["wa"]);
    expect(store.getState().dm.contacts[0].lastMessagePreview).toBe("one");
  });

  it("rooms: upsertRoom creates a row; a message with room meta fills participants and subject", () => {
    const store = createTestStore();
    const roomId = "r".repeat(64);
    store.dispatch(upsertRoom({ conversationId: roomId, participants: [ME, PEER, "c".repeat(64)], subject: "Trip" }));
    let room = store.getState().dm.contacts.find((c) => c.pubkey === roomId)!;
    expect(room.isRoom).toBe(true);
    expect(room.subject).toBe("Trip");
    store.dispatch(
      addDMMessage({
        partnerPubkey: roomId,
        myPubkey: ME,
        message: { id: "m", senderPubkey: PEER, content: "hey", createdAt: 10, wrapId: "wm", rumorId: R1 },
        room: { participants: [ME, PEER, "c".repeat(64)], subject: "Trip 2" },
      }),
    );
    room = store.getState().dm.contacts.find((c) => c.pubkey === roomId)!;
    expect(room.subject).toBe("Trip 2");
    expect(room.unreadCount).toBe(1);
  });

  it("restoreDMState merges persisted flags instead of dropping them", () => {
    const store = createTestStore();
    store.dispatch(setConversationFlag({ field: "archived", conversationId: PEER, on: true, now: 10 }));
    store.dispatch(
      restoreDMState({
        flags: { pinned: { [PEER]: 20 }, archived: {}, muted: {}, expireAfter: {}, updatedAt: 20 },
      }),
    );
    const flags = store.getState().dm.flags;
    expect(isConversationFlagged(flags, "archived", PEER, 21)).toBe(true);
    expect(isConversationFlagged(flags, "pinned", PEER, 21)).toBe(true);
  });
});
