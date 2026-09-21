import { describe, it, expect } from "vitest";
import { dmSlice, MAX_DM_REACTION_EMOJI } from "../dmSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";

const {
  addDMMessage,
  setActiveConversation,
  markConversationRead,
  deleteDMMessage,
  editDMMessage,
  remoteDeleteDMMessage,
  reactDMMessage,
  removeDMReaction,
  deleteDMConversation,
} = dmSlice.actions;

const MY_PK = lunaVega.pubkey;
const PARTNER_PK = riverChen.pubkey;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    senderPubkey: PARTNER_PK,
    content: "hello",
    createdAt: 1000,
    wrapId: "wrap-1",
    ...overrides,
  };
}

describe("dmSlice", () => {
  // ─── addDMMessage ──────────────────────────────

  it("adds a DM message and creates contact entry", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage() as any,
        myPubkey: MY_PK,
      }),
    );
    const state = store.getState().dm;
    expect(state.messages[PARTNER_PK]).toHaveLength(1);
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0].pubkey).toBe(PARTNER_PK);
  });

  it("deduplicates messages by wrapId", () => {
    const store = createTestStore();
    const msg = makeMessage();
    store.dispatch(addDMMessage({ partnerPubkey: PARTNER_PK, message: msg as any, myPubkey: MY_PK }));
    store.dispatch(addDMMessage({ partnerPubkey: PARTNER_PK, message: msg as any, myPubkey: MY_PK }));
    expect(store.getState().dm.messages[PARTNER_PK]).toHaveLength(1);
  });

  it("inserts messages in ascending createdAt order", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ id: "m2", wrapId: "w2", createdAt: 2000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ id: "m1", wrapId: "w1", createdAt: 1000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    const msgs = store.getState().dm.messages[PARTNER_PK];
    expect(msgs[0].createdAt).toBe(1000);
    expect(msgs[1].createdAt).toBe(2000);
  });

  it("increments unread for incoming messages when not viewing conversation", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ senderPubkey: PARTNER_PK }) as any,
        myPubkey: MY_PK,
      }),
    );
    const contact = store.getState().dm.contacts[0];
    expect(contact.unreadCount).toBe(1);
  });

  it("does not increment unread for own messages", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ senderPubkey: MY_PK, wrapId: "own-w" }) as any,
        myPubkey: MY_PK,
      }),
    );
    const contact = store.getState().dm.contacts[0];
    expect(contact.unreadCount).toBe(0);
  });

  it("sorts contacts by lastMessageAt descending (newest first)", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: "pk-old",
        message: makeMessage({ wrapId: "w-old", createdAt: 1000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      addDMMessage({
        partnerPubkey: "pk-new",
        message: makeMessage({ wrapId: "w-new", createdAt: 2000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    const contacts = store.getState().dm.contacts;
    expect(contacts[0].pubkey).toBe("pk-new");
    expect(contacts[1].pubkey).toBe("pk-old");
  });

  // ─── setActiveConversation ─────────────────────

  it("sets active conversation and clears unread", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage() as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(setActiveConversation(PARTNER_PK));
    expect(store.getState().dm.activeConversation).toBe(PARTNER_PK);
    const contact = store.getState().dm.contacts.find(
      (c) => c.pubkey === PARTNER_PK,
    );
    expect(contact?.unreadCount).toBe(0);
  });

  it("clears active conversation when set to null", () => {
    const store = createTestStore();
    store.dispatch(setActiveConversation(PARTNER_PK));
    store.dispatch(setActiveConversation(null));
    expect(store.getState().dm.activeConversation).toBeNull();
  });

  // ─── markConversationRead ──────────────────────

  it("zeroes unread count for a conversation", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage() as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(markConversationRead(PARTNER_PK));
    const contact = store.getState().dm.contacts.find(
      (c) => c.pubkey === PARTNER_PK,
    );
    expect(contact?.unreadCount).toBe(0);
  });

  // ─── deleteDMMessage ───────────────────────────

  it("removes a message and updates contact preview", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ id: "m1", wrapId: "w1", content: "first", createdAt: 1000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ id: "m2", wrapId: "w2", content: "second", createdAt: 2000 }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(deleteDMMessage({ partnerPubkey: PARTNER_PK, wrapId: "w2" }));
    expect(store.getState().dm.messages[PARTNER_PK]).toHaveLength(1);
    expect(store.getState().dm.contacts[0].lastMessagePreview).toBe("first");
  });

  it("removes contact when last message is deleted", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage() as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(deleteDMMessage({ partnerPubkey: PARTNER_PK, wrapId: "wrap-1" }));
    expect(store.getState().dm.contacts).toHaveLength(0);
  });

  // ─── editDMMessage ─────────────────────────────

  it("edits a message by rumorId", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-1" }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      editDMMessage({
        partnerPubkey: PARTNER_PK,
        rumorId: "rumor-1",
        newContent: "edited!",
        editedAt: 2000,
        senderPubkey: PARTNER_PK, // the original author edits their own message
      }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.editedContent).toBe("edited!");
    expect(msg.editedAt).toBe(2000);
  });

  // PROBE #23/#32 — pre-fix: a DM partner could edit/delete YOUR messages.
  // post-fix asserts: an edit/delete whose author != the message's senderPubkey is ignored.
  it("PROBE #23 — ignores an edit from a non-author (cannot rewrite your message)", () => {
    const store = createTestStore();
    // message authored by ME, sitting in the conversation with PARTNER
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-mine", senderPubkey: MY_PK, content: "my secret" }) as any,
        myPubkey: MY_PK,
      }),
    );
    // PARTNER forges an edit of MY message
    store.dispatch(
      editDMMessage({
        partnerPubkey: PARTNER_PK,
        rumorId: "rumor-mine",
        newContent: "tampered",
        editedAt: 2000,
        senderPubkey: PARTNER_PK,
        wrapId: "attacker-wrap-1",
      }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.editedContent).toBeUndefined();
    expect(msg.content).toBe("my secret");
  });

  it("PROBE #23 — dedups the edit wrap (self-wrap echo is a no-op)", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-1", senderPubkey: PARTNER_PK }) as any,
        myPubkey: MY_PK,
      }),
    );
    const edit = {
      partnerPubkey: PARTNER_PK,
      rumorId: "rumor-1",
      newContent: "v2",
      editedAt: 2000,
      senderPubkey: PARTNER_PK,
      wrapId: "edit-wrap-1",
    };
    store.dispatch(editDMMessage(edit));
    store.dispatch(editDMMessage({ ...edit, newContent: "v3" })); // same wrapId → ignored
    expect(store.getState().dm.messages[PARTNER_PK][0].editedContent).toBe("v2");
  });

  it("#87 — refreshes the conversation preview when the latest message is edited", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-1", senderPubkey: PARTNER_PK, content: "original" }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      editDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", newContent: "brand new preview", editedAt: 2000, senderPubkey: PARTNER_PK }),
    );
    expect(store.getState().dm.contacts[0].lastMessagePreview).toContain("brand new preview");
  });

  // ─── remoteDeleteDMMessage ─────────────────────

  it("marks a message as deleted", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-1" }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      remoteDeleteDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", senderPubkey: PARTNER_PK }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.isDeleted).toBe(true);
  });

  it("PROBE #32 — ignores a delete from a non-author", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-mine", senderPubkey: MY_PK, content: "keep me" }) as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(
      remoteDeleteDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-mine", senderPubkey: PARTNER_PK, wrapId: "attacker-wrap-2" }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.isDeleted).toBeFalsy();
    expect(msg.content).toBe("keep me");
  });

  // ─── reactions ─────────────────────────────────

  function seedTarget(store: ReturnType<typeof createTestStore>, extra: Record<string, unknown> = {}) {
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage({ rumorId: "rumor-1", wrapId: "wrap-1", ...extra }) as any,
        myPubkey: MY_PK,
      }),
    );
  }
  const msg0 = (store: ReturnType<typeof createTestStore>) => store.getState().dm.messages[PARTNER_PK][0];

  it("reactDMMessage records emoji → reactor pubkeys on the message found by rumorId", () => {
    const store = createTestStore();
    seedTarget(store);
    const before = store.getState().dm.mutationCounter;
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "rx-wrap-1" }));
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: PARTNER_PK, wrapId: "rx-wrap-2" }));
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "❤️", reactorPubkey: PARTNER_PK, wrapId: "rx-wrap-3" }));
    expect(msg0(store).reactions).toEqual({ "🔥": [MY_PK, PARTNER_PK], "❤️": [PARTNER_PK] });
    // Persistence fingerprint moved so the reactions get saved.
    expect(store.getState().dm.mutationCounter).toBeGreaterThan(before);
    // Reactions never touch the conversation preview / unread state.
    expect(store.getState().dm.contacts[0].lastMessagePreview).toBe("hello");
  });

  it("dedupes the self-wrap echo of an optimistic reaction by wrapId", () => {
    const store = createTestStore();
    seedTarget(store);
    const payload = { partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "self-wrap" };
    store.dispatch(reactDMMessage(payload)); // optimistic
    const counter = store.getState().dm.mutationCounter;
    store.dispatch(reactDMMessage(payload)); // echo from relay
    expect(msg0(store).reactions).toEqual({ "🔥": [MY_PK] });
    expect(store.getState().dm.mutationCounter).toBe(counter);
    // Even with a fresh wrap id, the same reactor + emoji is idempotent.
    store.dispatch(reactDMMessage({ ...payload, wrapId: "other-device-wrap" }));
    expect(msg0(store).reactions).toEqual({ "🔥": [MY_PK] });
  });

  it("removeDMReaction clears only the reactor's own entry and prunes empty emoji", () => {
    const store = createTestStore();
    seedTarget(store);
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "a" }));
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: PARTNER_PK, wrapId: "b" }));
    // Partner tries to remove MY reaction — only their own entry is affected.
    store.dispatch(removeDMReaction({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: PARTNER_PK, wrapId: "c" }));
    expect(msg0(store).reactions).toEqual({ "🔥": [MY_PK] });
    store.dispatch(removeDMReaction({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "d" }));
    expect(msg0(store).reactions).toBeUndefined();
    // Removing what isn't there is a no-op.
    const counter = store.getState().dm.mutationCounter;
    store.dispatch(removeDMReaction({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "e" }));
    expect(store.getState().dm.mutationCounter).toBe(counter);
  });

  it("caps distinct emoji per message at MAX_DM_REACTION_EMOJI but still accepts reactors on existing emoji", () => {
    const store = createTestStore();
    seedTarget(store);
    for (let i = 0; i < MAX_DM_REACTION_EMOJI + 3; i++) {
      store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: `e${i}`, reactorPubkey: MY_PK, wrapId: `w${i}` }));
    }
    const reactions = msg0(store).reactions!;
    expect(Object.keys(reactions)).toHaveLength(MAX_DM_REACTION_EMOJI);
    expect(reactions["e0"]).toEqual([MY_PK]);
    expect(reactions[`e${MAX_DM_REACTION_EMOJI}`]).toBeUndefined();
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "e0", reactorPubkey: PARTNER_PK, wrapId: "late" }));
    expect(msg0(store).reactions!["e0"]).toEqual([MY_PK, PARTNER_PK]);
    expect(Object.keys(msg0(store).reactions!)).toHaveLength(MAX_DM_REACTION_EMOJI);
  });

  it("falls back to matching the anchor against wrapId for legacy messages without a rumorId", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({ partnerPubkey: PARTNER_PK, message: makeMessage({ wrapId: "legacy-wrap", rumorId: undefined }) as any, myPubkey: MY_PK }),
    );
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "legacy-wrap", emoji: "👍", reactorPubkey: PARTNER_PK, wrapId: "rx" }));
    expect(msg0(store).reactions).toEqual({ "👍": [PARTNER_PK] });
  });

  it("buffers a reaction that arrives before its target and applies it when the message lands", () => {
    const store = createTestStore();
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-late", emoji: "🎉", reactorPubkey: PARTNER_PK, wrapId: "rx-early" }));
    store.dispatch(removeDMReaction({ partnerPubkey: PARTNER_PK, rumorId: "rumor-late", emoji: "🎉", reactorPubkey: MY_PK, wrapId: "rx-early-2" }));
    expect(store.getState().dm.messages[PARTNER_PK]).toBeUndefined();
    expect(store.getState().dm.pendingReactions["rumor-late"]).toHaveLength(2);

    store.dispatch(
      addDMMessage({ partnerPubkey: PARTNER_PK, message: makeMessage({ rumorId: "rumor-late", wrapId: "wrap-late" }) as any, myPubkey: MY_PK }),
    );
    expect(msg0(store).reactions).toEqual({ "🎉": [PARTNER_PK] });
    expect(store.getState().dm.pendingReactions["rumor-late"]).toBeUndefined();
    // The early wrap is still deduped if it is re-delivered later.
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-late", emoji: "🎉", reactorPubkey: PARTNER_PK, wrapId: "rx-early" }));
    expect(msg0(store).reactions).toEqual({ "🎉": [PARTNER_PK] });
  });

  it("ignores empty emoji content", () => {
    const store = createTestStore();
    seedTarget(store);
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "   ", reactorPubkey: MY_PK, wrapId: "x" }));
    expect(msg0(store).reactions).toBeUndefined();
  });

  it("reactions survive a persistence round-trip through restoreDMState", () => {
    const store = createTestStore();
    seedTarget(store);
    store.dispatch(reactDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1", emoji: "🔥", reactorPubkey: MY_PK, wrapId: "a" }));
    const snapshot = JSON.parse(JSON.stringify(store.getState().dm));
    const fresh = createTestStore();
    fresh.dispatch(dmSlice.actions.restoreDMState({ messages: snapshot.messages, contacts: snapshot.contacts, processedWrapIds: snapshot.processedWrapIds }));
    expect(msg0(fresh).reactions).toEqual({ "🔥": [MY_PK] });
  });

  // ─── deleteDMConversation ──────────────────────

  it("deletes entire conversation", () => {
    const store = createTestStore();
    store.dispatch(
      addDMMessage({
        partnerPubkey: PARTNER_PK,
        message: makeMessage() as any,
        myPubkey: MY_PK,
      }),
    );
    store.dispatch(deleteDMConversation(PARTNER_PK));
    expect(store.getState().dm.messages[PARTNER_PK]).toBeUndefined();
    expect(store.getState().dm.contacts.find((c) => c.pubkey === PARTNER_PK)).toBeUndefined();
  });
});
