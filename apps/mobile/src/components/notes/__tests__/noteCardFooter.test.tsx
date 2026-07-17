import { Provider } from "react-redux";
import { screen, userEvent } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCardFooter, type NoteFooterHandlers } from "../NoteCardFooter";
import { NoteCard } from "../NoteCard";
import type { PlatformAdapters } from "@/core/adapters";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore, type AppStore } from "@/store";
import { setIdentity } from "@/store/slices/identitySlice";
import { engagementReceived } from "@/store/slices/engagementSlice";
import { zapReceiptSeen } from "@/store/slices/zapsSlice";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.useFakeTimers();

const note: NostrEvent = {
  id: "note-1",
  pubkey: "author",
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "s",
};

function makeStore(): AppStore {
  return createStore({ marker: "fake" } as unknown as PlatformAdapters);
}

function handlers(overrides: Partial<NoteFooterHandlers> = {}): NoteFooterHandlers {
  return {
    reply: jest.fn(),
    repost: jest.fn(),
    like: jest.fn(),
    zap: jest.fn(),
    share: jest.fn(),
    ...overrides,
  };
}

function renderFooter(store: AppStore, h: NoteFooterHandlers) {
  return renderWithTheme(
    <Provider store={store}>
      <NoteCardFooter event={note} handlers={h} />
    </Provider>,
  );
}

describe("NoteCardFooter", () => {
  it("renders all five actions with no counts at zero", async () => {
    await renderFooter(makeStore(), handlers());
    expect(screen.getByRole("button", { name: "Reply" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Repost" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Like" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Zap" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Share" })).toBeOnTheScreen();
    expect(screen.queryByText("1")).not.toBeOnTheScreen();
  });

  it("shows live counts from the engagement + zap aggregates", async () => {
    const store = makeStore();
    store.dispatch(
      engagementReceived({
        reactions: [
          { targetEventId: note.id, reactor: "a", content: "+", eventId: "r1" },
          { targetEventId: note.id, reactor: "b", content: "+", eventId: "r2" },
        ],
        reposts: [{ targetEventId: note.id, reposter: "c", eventId: "rp1" }],
        replies: [{ targetEventId: note.id, eventId: "reply-1" }],
      }),
    );
    store.dispatch(
      zapReceiptSeen({ receiptId: "z1", targetEventId: note.id, msat: 2_100_000 }),
    );

    await renderFooter(store, handlers());
    expect(screen.getByRole("button", { name: "Like, 2 likes" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Repost, 1 reposts" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Reply, 1 replies" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Zap, 2100 sats" })).toHaveTextContent("2.1k sats");
  });

  it("marks liked/reposted state for the signed-in user", async () => {
    const store = makeStore();
    store.dispatch(setIdentity({ pubkey: "me", signerType: "local_nsec" }));
    store.dispatch(
      engagementReceived({
        reactions: [{ targetEventId: note.id, reactor: "me", content: "+", eventId: "r1" }],
        reposts: [{ targetEventId: note.id, reposter: "me", eventId: "rp1" }],
        replies: [],
      }),
    );

    await renderFooter(store, handlers());
    expect(screen.getByRole("button", { name: "Like, 1 likes" })).toBeSelected();
    expect(screen.getByRole("button", { name: "Repost, 1 reposts" })).toBeSelected();
  });

  it("routes presses to the right handler with the note", async () => {
    const user = userEvent.setup();
    const h = handlers();
    await renderFooter(makeStore(), h);

    await user.press(screen.getByRole("button", { name: "Reply" }));
    await user.press(screen.getByRole("button", { name: "Share" }));
    expect(h.reply).toHaveBeenCalledWith(note);
    expect(h.share).toHaveBeenCalledWith(note);
    expect(h.like).not.toHaveBeenCalled();
  });
});

describe("NoteCard footer back-compat", () => {
  it("renders the legacy zap line when no footer handlers are given", async () => {
    const store = makeStore();
    store.dispatch(
      zapReceiptSeen({ receiptId: "z1", targetEventId: note.id, msat: 5_000_000 }),
    );
    await renderWithTheme(
      <Provider store={store}>
        <NoteCard event={note} />
      </Provider>,
    );
    expect(screen.getByText(/5,000 sats/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeOnTheScreen();
  });

  it("renders the action row instead when footer handlers are given", async () => {
    await renderWithTheme(
      <Provider store={makeStore()}>
        <NoteCard event={note} footer={handlers()} />
      </Provider>,
    );
    expect(screen.getByRole("button", { name: "Reply" })).toBeOnTheScreen();
  });
});
