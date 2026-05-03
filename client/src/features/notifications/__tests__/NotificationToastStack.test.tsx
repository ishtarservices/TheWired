import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { NotificationToastStack } from "../NotificationToast";
import {
  addNotification,
  clearAllNotifications,
  removeNotification,
  type InAppNotification,
} from "@/store/slices/notificationSlice";

function makeNotif(overrides: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id: "n1",
    type: "dm",
    title: "New DM",
    body: "hello there",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("NotificationToastStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast when a new notification is added", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n1", body: "hi-new" })));
    });
    expect(screen.queryByText("hi-new")).not.toBeNull();
  });

  it("marks the notification as toastShown in Redux after surfacing", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n1" })));
    });
    const n = store.getState().notifications.notifications.find((x) => x.id === "n1");
    expect(n?.toastShown).toBe(true);
  });

  it("does NOT toast restored notifications that have toastShown=true", () => {
    renderWithProviders(<NotificationToastStack />, {
      preloadedState: {
        notifications: {
          spaceUnread: {},
          channelUnread: {},
          spaceMentions: {},
          channelMentions: {},
          notifications: [makeNotif({ id: "restored", body: "should-not-show", toastShown: true })],
          spaceMutes: {},
          preferences: {
            enabled: true,
            mentions: true,
            dms: true,
            newFollowers: true,
            chatMessages: true,
            browserNotifications: false,
            sound: false,
            dnd: false,
          },
          lastReadTimestamps: {},
          channelNotifSettings: {},
          spaceNotifSettings: {},
          unreadDividerTimestamps: {},
          dismissedNotifIds: [],
        },
      },
    });
    expect(screen.queryByText("should-not-show")).toBeNull();
  });

  it("does NOT re-fire toast for the same notification after it has been surfaced once", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n1", body: "first" })));
    });
    expect(screen.queryByText("first")).not.toBeNull();

    // Auto-dismiss the persistent DM toast
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.queryByText("first")).toBeNull();

    // Force a re-render by dispatching an unrelated state update — toast must not return
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n2", body: "second" })));
    });
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.queryByText("second")).not.toBeNull();
  });

  it("auto-dismisses ephemeral (follow) toasts after 5s and keeps persistent types in Redux", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(
        addNotification(makeNotif({ id: "f1", type: "follow", body: "followed-you" })),
      );
    });
    expect(screen.queryByText("followed-you")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.queryByText("followed-you")).toBeNull();
    // "follow" without an action is persistent — bell should still show it.
    const stillPresent = store
      .getState()
      .notifications.notifications.some((n) => n.id === "f1");
    expect(stillPresent).toBe(true);
  });

  it("removes an in-flight toast when notifications are cleared from Redux", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n1", body: "in-flight" })));
    });
    expect(screen.queryByText("in-flight")).not.toBeNull();

    act(() => {
      store.dispatch(clearAllNotifications());
    });
    expect(screen.queryByText("in-flight")).toBeNull();
  });

  it("removes an in-flight toast when removeNotification is dispatched (e.g. acted on)", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "n1", body: "act-on-me" })));
    });
    expect(screen.queryByText("act-on-me")).not.toBeNull();

    act(() => {
      store.dispatch(removeNotification("n1"));
    });
    expect(screen.queryByText("act-on-me")).toBeNull();
  });

  it("renders multiple stacked toasts", () => {
    const { store } = renderWithProviders(<NotificationToastStack />);
    act(() => {
      store.dispatch(addNotification(makeNotif({ id: "a", body: "alpha" })));
      store.dispatch(addNotification(makeNotif({ id: "b", body: "beta" })));
      store.dispatch(addNotification(makeNotif({ id: "c", body: "gamma" })));
    });
    expect(screen.queryByText("alpha")).not.toBeNull();
    expect(screen.queryByText("beta")).not.toBeNull();
    expect(screen.queryByText("gamma")).not.toBeNull();
  });
});
