import { describe, it, expect } from "vitest";
import { notificationSlice } from "../notificationSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";

const {
  incrementUnread,
  incrementMention,
  clearChannelUnread,
  clearSpaceUnread,
  addNotification,
  removeNotification,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
  setSpaceMute,
  removeSpaceMute,
  setPreferences,
  updateLastRead,
  setUnreadDivider,
  clearUnreadDivider,
  setChannelNotifMode,
} = notificationSlice.actions;

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif-1",
    type: "chat" as const,
    title: "New message",
    body: "Hello",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("notificationSlice", () => {
  // ─── Unread counts ─────────────────────────────

  it("increments channel and space unread", () => {
    const store = createTestStore();
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    const state = store.getState().notifications;
    expect(state.channelUnread["s1:ch1"]).toBe(1);
    expect(state.spaceUnread["s1"]).toBe(1);
  });

  it("accumulates unread counts", () => {
    const store = createTestStore();
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch2" }));
    const state = store.getState().notifications;
    expect(state.channelUnread["s1:ch1"]).toBe(2);
    expect(state.channelUnread["s1:ch2"]).toBe(1);
    expect(state.spaceUnread["s1"]).toBe(3);
  });

  it("clears channel unread and subtracts from space", () => {
    const store = createTestStore();
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch2" }));
    store.dispatch(clearChannelUnread("s1:ch1"));
    const state = store.getState().notifications;
    expect(state.channelUnread["s1:ch1"]).toBeUndefined();
    expect(state.spaceUnread["s1"]).toBe(1); // Only ch2's count remains
  });

  it("clears all unread for a space", () => {
    const store = createTestStore();
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch1" }));
    store.dispatch(incrementUnread({ spaceId: "s1", channelId: "s1:ch2" }));
    store.dispatch(clearSpaceUnread("s1"));
    const state = store.getState().notifications;
    expect(state.spaceUnread["s1"]).toBeUndefined();
    expect(state.channelUnread["s1:ch1"]).toBeUndefined();
    expect(state.channelUnread["s1:ch2"]).toBeUndefined();
  });

  // ─── Mentions ──────────────────────────────────

  it("increments mention counts", () => {
    const store = createTestStore();
    store.dispatch(incrementMention({ spaceId: "s1", channelId: "s1:ch1" }));
    const state = store.getState().notifications;
    expect(state.channelMentions["s1:ch1"]).toBe(1);
    expect(state.spaceMentions["s1"]).toBe(1);
  });

  // ─── Notifications ─────────────────────────────

  it("adds a notification", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification()));
    expect(store.getState().notifications.notifications).toHaveLength(1);
  });

  it("deduplicates notifications by id (skips if exists)", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification({ body: "v1" })));
    store.dispatch(addNotification(makeNotification({ body: "v2" })));
    const notifs = store.getState().notifications.notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].body).toBe("v1"); // First one preserved, second skipped
  });

  it("caps notifications at 50", () => {
    const store = createTestStore();
    for (let i = 0; i < 55; i++) {
      store.dispatch(
        addNotification(makeNotification({ id: `n-${i}`, timestamp: i })),
      );
    }
    expect(store.getState().notifications.notifications.length).toBeLessThanOrEqual(50);
  });

  it("removes a notification", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification()));
    store.dispatch(removeNotification("notif-1"));
    expect(store.getState().notifications.notifications).toHaveLength(0);
  });

  it("marks a notification as read", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification()));
    store.dispatch(markNotificationRead("notif-1"));
    expect(store.getState().notifications.notifications[0].read).toBe(true);
  });

  it("marks all notifications as read", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification({ id: "n1" })));
    store.dispatch(addNotification(makeNotification({ id: "n2" })));
    store.dispatch(markAllNotificationsRead());
    store.getState().notifications.notifications.forEach((n) => {
      expect(n.read).toBe(true);
    });
  });

  it("clears all notifications", () => {
    const store = createTestStore();
    store.dispatch(addNotification(makeNotification()));
    store.dispatch(clearAllNotifications());
    expect(store.getState().notifications.notifications).toHaveLength(0);
  });

  // ─── Space mute ────────────────────────────────

  it("sets and removes space mute", () => {
    const store = createTestStore();
    store.dispatch(setSpaceMute({ spaceId: "s1", mute: { muted: true } }));
    expect(store.getState().notifications.spaceMutes["s1"]).toEqual({
      muted: true,
    });
    store.dispatch(removeSpaceMute("s1"));
    expect(store.getState().notifications.spaceMutes["s1"]).toBeUndefined();
  });

  // ─── Preferences ───────────────────────────────

  it("merges notification preferences", () => {
    const store = createTestStore();
    store.dispatch(setPreferences({ dnd: true, sound: true }));
    const prefs = store.getState().notifications.preferences;
    expect(prefs.dnd).toBe(true);
    expect(prefs.sound).toBe(true);
    // Other defaults should remain
    expect(prefs.enabled).toBe(true);
  });

  // ─── Unread dividers ───────────────────────────

  it("sets and clears unread divider timestamps", () => {
    const store = createTestStore();
    store.dispatch(setUnreadDivider({ channelId: "ch1", timestamp: 1000 }));
    expect(store.getState().notifications.unreadDividerTimestamps["ch1"]).toBe(1000);
    store.dispatch(clearUnreadDivider("ch1"));
    expect(store.getState().notifications.unreadDividerTimestamps["ch1"]).toBeUndefined();
  });

  // ─── Last read timestamps ──────────────────────

  it("updates last read timestamp", () => {
    const store = createTestStore();
    store.dispatch(updateLastRead({ contextId: "s1:ch1", timestamp: 5000 }));
    expect(store.getState().notifications.lastReadTimestamps["s1:ch1"]).toBe(5000);
  });

  // ─── Channel notification mode ─────────────────

  it("sets channel notification mode", () => {
    const store = createTestStore();
    store.dispatch(
      setChannelNotifMode({ channelId: "s1:ch1", mode: "mentions" }),
    );
    expect(store.getState().notifications.channelNotifSettings["s1:ch1"]).toBe(
      "mentions",
    );
  });

  it("removes channel setting when mode is 'default'", () => {
    const store = createTestStore();
    store.dispatch(
      setChannelNotifMode({ channelId: "s1:ch1", mode: "mentions" }),
    );
    store.dispatch(
      setChannelNotifMode({ channelId: "s1:ch1", mode: "default" }),
    );
    expect(
      store.getState().notifications.channelNotifSettings["s1:ch1"],
    ).toBeUndefined();
  });
});
