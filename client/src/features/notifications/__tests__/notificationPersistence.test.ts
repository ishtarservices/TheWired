import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { loadNotificationState } from "../notificationPersistence";
import { saveUserState } from "@/lib/db/userStateStore";
import { getDB } from "@/lib/db/database";
import { store, resetAll } from "@/store";
import type { InAppNotification } from "@/store/slices/notificationSlice";

const NOTIFS_KEY = "notification_items";

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  store.dispatch(resetAll());
});

describe("notificationPersistence — toast re-fire prevention", () => {
  it("flags persisted notifications as toastShown=true on restore", async () => {
    const persisted: InAppNotification[] = [
      { id: "p1", type: "dm", title: "DM", body: "saved-1", timestamp: 1 },
      { id: "p2", type: "mention", title: "@you", body: "saved-2", timestamp: 2 },
      // Already flagged — should remain flagged (no double-flip)
      { id: "p3", type: "follow", title: "Follow", body: "saved-3", timestamp: 3, toastShown: true },
    ];
    await saveUserState(NOTIFS_KEY, persisted);

    await loadNotificationState();

    const restored = store.getState().notifications.notifications;
    expect(restored).toHaveLength(3);
    for (const n of restored) {
      expect(n.toastShown).toBe(true);
    }
  });

  it("preserves existing notification fields during the toastShown migration", async () => {
    const persisted: InAppNotification[] = [
      {
        id: "p1",
        type: "friend_request",
        title: "Friend Request",
        body: "wants to connect",
        timestamp: 12345,
        actorPubkey: "abc",
        actionType: "accept_friend",
        actionTarget: "abc",
        read: true,
      },
    ];
    await saveUserState(NOTIFS_KEY, persisted);

    await loadNotificationState();

    const [n] = store.getState().notifications.notifications;
    expect(n).toMatchObject({
      id: "p1",
      type: "friend_request",
      actorPubkey: "abc",
      actionType: "accept_friend",
      actionTarget: "abc",
      read: true,
      toastShown: true,
    });
  });

  it("is a no-op for empty persisted lists (no notifications dispatched)", async () => {
    await loadNotificationState();
    expect(store.getState().notifications.notifications).toEqual([]);
  });
});
