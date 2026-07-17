import { Provider } from "react-redux";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { screen, userEvent } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteThreadScreen } from "../NoteThreadScreen";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore } from "@/store";
import { userMuted } from "@/store/slices/moderationSlice";
import {
  threadEventsMerged,
  threadFetchCompleted,
  threadFetchStarted,
} from "@/store/slices/threadsSlice";

const mockDispatch = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: jest.fn(),
    getParent: () => undefined,
    getState: () => ({ routes: [] }),
    dispatch: mockDispatch,
  }),
}));

const ROOT_ID = "1".repeat(64);
const A_ID = "2".repeat(64);
const B_ID = "3".repeat(64);
const C_ID = "4".repeat(64);

function note(
  id: string,
  content: string,
  created_at: number,
  tags: string[][] = [],
): NostrEvent {
  return { id, pubkey: id.slice(0, 8).padEnd(64, "f"), created_at, kind: 1, tags, content, sig: "s" };
}

const replyTags = (rootId: string, parentId: string): string[][] =>
  rootId === parentId
    ? [["e", rootId, "", "root"]]
    : [
        ["e", rootId, "", "root"],
        ["e", parentId, "", "reply"],
      ];

/** root ← A ← B ← C — a 3-deep chain under the root. */
function chainEvents(): NostrEvent[] {
  return [
    note(ROOT_ID, "root content", 100),
    note(A_ID, "reply A", 110, replyTags(ROOT_ID, ROOT_ID)),
    note(B_ID, "reply B", 120, replyTags(ROOT_ID, A_ID)),
    note(C_ID, "reply C", 130, replyTags(ROOT_ID, B_ID)),
  ];
}

function makeEngine(): NostrEngine {
  return {
    loadThread: jest.fn().mockResolvedValue(undefined),
    loadOlderReplies: jest.fn().mockResolvedValue(undefined),
    requestProfiles: jest.fn(),
    fetchEvents: jest.fn().mockResolvedValue([]),
    subscribeEngagement: jest.fn(),
    unsubscribeEngagement: jest.fn(),
  } as unknown as NostrEngine;
}

function seedThread(store: ReturnType<typeof createStore>, events: NostrEvent[]): void {
  store.dispatch(threadFetchStarted({ rootId: ROOT_ID }));
  store.dispatch(threadEventsMerged({ rootId: ROOT_ID, events }));
  store.dispatch(
    threadFetchCompleted({
      rootId: ROOT_ID,
      fetchedAt: Math.floor(Date.now() / 1000), // fresh — SWR must not refetch
      truncated: false,
      oldestReplyAt: 110,
    }),
  );
}

async function renderScreen(
  store: ReturnType<typeof createStore>,
  engine: NostrEngine,
  params: { noteId: string; rootId?: string },
) {
  return renderWithTheme(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Provider store={store}>
        <EngineProvider engine={engine}>
          <NoteThreadScreen
            route={{ key: "t", name: "NoteThread", params } as never}
            navigation={{} as never}
          />
        </EngineProvider>
      </Provider>
    </SafeAreaProvider>,
  );
}

describe("NoteThreadScreen (anchored thread view)", () => {
  it("renders a cached conversation instantly — tree, depth clamp, no refetch", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    seedThread(store, chainEvents());
    const engine = makeEngine();

    await renderScreen(store, engine, { noteId: ROOT_ID, rootId: ROOT_ID });

    expect(screen.getByText("root content")).toBeOnTheScreen();
    expect(screen.getByText("reply A")).toBeOnTheScreen();
    expect(screen.getByText("reply B")).toBeOnTheScreen();
    expect(screen.getByText(/replies · 3/)).toBeOnTheScreen();
    // Depth clamp: C hides behind B's expander.
    expect(screen.queryByText("reply C")).toBeNull();
    expect(screen.getByText(/show 1 more reply/)).toBeOnTheScreen();
    // Fresh cache — the SWR load must not have fired.
    expect(engine.loadThread).not.toHaveBeenCalled();
  });

  it("expands a collapsed branch in place", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    seedThread(store, chainEvents());

    await renderScreen(store, makeEngine(), { noteId: ROOT_ID, rootId: ROOT_ID });
    const user = userEvent.setup();
    await user.press(screen.getByText(/show 1 more reply/));

    expect(screen.getByText("reply C")).toBeOnTheScreen();
  });

  it("keeps a muted author's replies reachable behind a placeholder", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    const events = chainEvents();
    seedThread(store, events);
    store.dispatch(userMuted(events[1].pubkey)); // mute A's author

    await renderScreen(store, makeEngine(), { noteId: ROOT_ID, rootId: ROOT_ID });

    expect(screen.queryByText("reply A")).toBeNull();
    expect(screen.getByText("Note from a blocked user")).toBeOnTheScreen();
    // A's child survives the mute — the tree keeps structure.
    expect(screen.getByText("reply B")).toBeOnTheScreen();
  });

  it("anchors mid-thread: bounded ancestor block above the focus, expandable in place", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    seedThread(store, chainEvents());

    await renderScreen(store, makeEngine(), { noteId: C_ID, rootId: ROOT_ID });

    // Chain root→A→B collapses to root + gap + B (compact rows clamp to 2 lines).
    expect(screen.getByText("root content")).toBeOnTheScreen();
    expect(screen.getByText("reply B")).toBeOnTheScreen();
    expect(screen.getByText("reply C")).toBeOnTheScreen(); // the focus
    expect(screen.queryByText("reply A")).toBeNull();
    const gap = screen.getByText(/in reply chain — 1 more/);

    const user = userEvent.setup();
    await user.press(gap);
    expect(screen.getByText("reply A")).toBeOnTheScreen();
  });

  it("surfaces truncation honestly and pages older replies on demand", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    const engine = makeEngine();
    store.dispatch(threadFetchStarted({ rootId: ROOT_ID }));
    store.dispatch(threadEventsMerged({ rootId: ROOT_ID, events: chainEvents() }));
    store.dispatch(
      threadFetchCompleted({
        rootId: ROOT_ID,
        fetchedAt: Math.floor(Date.now() / 1000),
        truncated: true,
        oldestReplyAt: 110,
      }),
    );

    await renderScreen(store, engine, { noteId: ROOT_ID, rootId: ROOT_ID });
    const loadOlder = screen.getByText(/load older/);

    const user = userEvent.setup();
    await user.press(loadOlder);
    expect(engine.loadOlderReplies).toHaveBeenCalledWith(ROOT_ID);
  });

  it("backfills a missing ancestor to complete the chain", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    const [root, a, b, c] = chainEvents();
    // Seed everything EXCEPT "a" — the chain from focus c stops at b.
    seedThread(store, [root, b, c]);
    const engine = makeEngine();
    (engine.fetchEvents as jest.Mock).mockImplementation(async (filters: { ids?: string[] }[]) =>
      filters[0]?.ids?.includes(a.id) ? [a] : [],
    );

    await renderScreen(store, engine, { noteId: C_ID, rootId: ROOT_ID });

    // Backfill fetched "a" by id, the chain reached the root, and the
    // collapsed ancestor block now shows it.
    expect(await screen.findByText("root content")).toBeOnTheScreen();
    expect(engine.fetchEvents).toHaveBeenCalledWith([{ ids: [a.id] }]);
    expect(store.getState().threads.byRoot[ROOT_ID]?.events.some((e) => e.id === a.id)).toBe(
      true,
    );
  });

  it("gives up on an unfetchable ancestor after one attempt (gap stays honest)", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    const [root, , b, c] = chainEvents();
    seedThread(store, [root, b, c]);
    const engine = makeEngine(); // fetchEvents resolves []

    await renderScreen(store, engine, { noteId: C_ID, rootId: ROOT_ID });

    expect(await screen.findByText(/earlier context unavailable/)).toBeOnTheScreen();
    const idFetches = (engine.fetchEvents as jest.Mock).mock.calls.filter(
      (call) => (call[0] as { ids?: string[] }[])[0]?.ids?.includes(A_ID),
    );
    expect(idFetches).toHaveLength(1);
  });

  it("shows the unavailable state when the conversation settles empty", async () => {
    const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
    store.dispatch(threadFetchStarted({ rootId: ROOT_ID }));
    store.dispatch(
      threadFetchCompleted({
        rootId: ROOT_ID,
        fetchedAt: Math.floor(Date.now() / 1000),
        truncated: false,
        oldestReplyAt: null,
      }),
    );

    await renderScreen(store, makeEngine(), { noteId: ROOT_ID, rootId: ROOT_ID });

    expect(screen.getByText("Note unavailable")).toBeOnTheScreen();
  });
});
