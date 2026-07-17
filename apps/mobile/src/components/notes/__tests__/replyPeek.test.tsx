import { Provider } from "react-redux";
import { screen, userEvent } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard } from "../NoteCard";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore } from "@/store";
import { engagementReceived } from "@/store/slices/engagementSlice";
import { userMuted } from "@/store/slices/moderationSlice";

const mockNavDispatch = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: jest.fn(),
    getParent: () => undefined,
    getState: () => ({ routes: [] }),
    dispatch: mockNavDispatch,
  }),
}));

const ROOT_ID = "a".repeat(64);

function note(id: string, content: string, tags: string[][] = []): NostrEvent {
  return {
    id,
    pubkey: id.slice(0, 8).padEnd(64, "e"),
    created_at: 1_700_000_000,
    kind: 1,
    tags,
    content,
    sig: "s",
  };
}

const root = note(ROOT_ID, "root note");
const replyA = note("b".repeat(64), "first reply", [["e", ROOT_ID, "", "root"]]);
const replyB = note("c".repeat(64), "second reply", [["e", ROOT_ID, "", "root"]]);
// A quote post e-mentioning the root — must never appear as a reply.
const quote = note("d".repeat(64), "look at this", [["e", ROOT_ID, "", "mention"]]);

async function setup(replyEvents: NostrEvent[]) {
  const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
  const engine = {
    requestProfiles: jest.fn(),
    fetchEvents: jest.fn().mockResolvedValue(replyEvents),
  } as unknown as NostrEngine;
  await renderWithTheme(
    <Provider store={store}>
      <EngineProvider engine={engine}>
        <NoteCard event={root} peek />
      </EngineProvider>
    </Provider>,
  );
  return { store, engine };
}

function seedCounts(store: ReturnType<typeof createStore>, replies: NostrEvent[]): void {
  store.dispatch(
    engagementReceived({
      reactions: [],
      reposts: [],
      replies: replies.map((r) => ({ targetEventId: ROOT_ID, eventId: r.id })),
    }),
  );
}

describe("ReplyPeek", () => {
  beforeEach(() => mockNavDispatch.mockClear());

  it("renders nothing while the note has no known replies", async () => {
    await setup([]);
    expect(screen.queryByText(/view replies/)).toBeNull();
  });

  it("expands top direct replies in place, excluding quotes, and seeds the cache", async () => {
    const { store } = await setup([replyA, quote, replyB]);
    seedCounts(store, [replyA, replyB]);

    expect(await screen.findByText("view replies · 2")).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByText("view replies · 2"));

    expect(await screen.findByText("first reply")).toBeOnTheScreen();
    expect(screen.getByText("second reply")).toBeOnTheScreen();
    expect(screen.queryByText("look at this")).toBeNull(); // quote excluded

    // The peek fetch seeded the thread cache — "view all" opens instantly.
    const entry = store.getState().threads.byRoot[ROOT_ID];
    expect(entry?.events.map((e) => e.id).sort()).toEqual(
      [root.id, replyA.id, replyB.id].sort(),
    );
  });

  it("'view all' opens the thread anchored on the note", async () => {
    const { store } = await setup([replyA, replyB]);
    seedCounts(store, [replyA, replyB]);

    const user = userEvent.setup();
    await user.press(await screen.findByText("view replies · 2"));
    await user.press(await screen.findByText(/view all 2 replies/));

    expect(mockNavDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PUSH",
        payload: expect.objectContaining({
          name: "NoteThread",
          params: { noteId: ROOT_ID, rootId: ROOT_ID },
        }),
      }),
    );
  });

  it("ranks by engagement when there are more candidates than rows", async () => {
    // 4 direct replies; the newest ("hot") carries reactions, so it must
    // outrank the chrono head into the 3 visible rows.
    const older = [1, 2, 3].map((i) =>
      note(`${i}`.padStart(64, "5"), `older reply ${i}`, [["e", ROOT_ID, "", "root"]]),
    );
    const hot = note("f".repeat(64), "hot reply", [["e", ROOT_ID, "", "root"]]);
    hot.created_at = 1_700_000_999;
    const { store } = await setup([...older, hot]);
    seedCounts(store, [...older, hot]);
    // A reaction targeting the hot reply (last e-tag, NIP-25).
    store.dispatch(
      engagementReceived({
        reactions: [{ targetEventId: hot.id, reactor: "x".repeat(64), content: "+", eventId: "1".repeat(64) }],
        reposts: [],
        replies: [],
      }),
    );

    const user = userEvent.setup();
    await user.press(await screen.findByText("view replies · 4"));

    expect(await screen.findByText("hot reply")).toBeOnTheScreen();
    // Ranked head is the hot reply; the chrono-last older reply drops out.
    expect(screen.getByText("older reply 1")).toBeOnTheScreen();
    expect(screen.getByText("older reply 2")).toBeOnTheScreen();
    expect(screen.queryByText("older reply 3")).toBeNull();
  });

  it("hides muted authors' replies inside the peek", async () => {
    const { store } = await setup([replyA, replyB]);
    seedCounts(store, [replyA, replyB]);
    store.dispatch(userMuted(replyA.pubkey));

    const user = userEvent.setup();
    await user.press(await screen.findByText("view replies · 2"));

    expect(await screen.findByText("second reply")).toBeOnTheScreen();
    expect(screen.queryByText("first reply")).toBeNull();
  });
});
