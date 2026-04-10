import { describe, it, expect } from "vitest";
import { dmSlice } from "../dmSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";

const {
  addDMMessage,
  setActiveConversation,
  markConversationRead,
  deleteDMMessage,
  editDMMessage,
  remoteDeleteDMMessage,
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
      }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.editedContent).toBe("edited!");
    expect(msg.editedAt).toBe(2000);
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
      remoteDeleteDMMessage({ partnerPubkey: PARTNER_PK, rumorId: "rumor-1" }),
    );
    const msg = store.getState().dm.messages[PARTNER_PK][0];
    expect(msg.isDeleted).toBe(true);
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
