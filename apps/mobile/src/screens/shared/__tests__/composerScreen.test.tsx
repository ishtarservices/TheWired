import { Provider } from "react-redux";
import { screen, userEvent } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { ComposerScreen } from "../ComposerScreen";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore, type AppStore } from "@/store";
import { feedEventsReceived } from "@/store/slices/feedSlice";
import { setIdentity } from "@/store/slices/identitySlice";

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

const rootNote: NostrEvent = {
  id: "root-1",
  pubkey: "author-1",
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "the note being replied to",
  sig: "s",
};

const nestedNote: NostrEvent = {
  ...rootNote,
  id: "nested-1",
  tags: [["e", "thread-root", "", "root"]],
};

function makeEngine(): NostrEngine {
  return {
    publishNote: jest.fn().mockResolvedValue(true),
    publishReply: jest.fn().mockResolvedValue(true),
    fetchEvents: jest.fn().mockResolvedValue([]),
    requestProfiles: jest.fn(),
  } as unknown as NostrEngine;
}

function makeStore(loggedIn = true): AppStore {
  const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
  if (loggedIn) {
    store.dispatch(setIdentity({ pubkey: "me", signerType: "local_nsec" }));
  }
  return store;
}

function makeNav() {
  return { goBack: jest.fn() } as never;
}

function route(params?: { mode: "note" | "reply" | "quote"; targetEventId?: string }) {
  return { key: "Composer-1", name: "Composer", params } as never;
}

function renderComposer(opts: {
  store: AppStore;
  engine: NostrEngine;
  params?: { mode: "note" | "reply" | "quote"; targetEventId?: string };
  navigation?: never;
}) {
  const navigation = opts.navigation ?? makeNav();
  const result = renderWithTheme(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 59, bottom: 34, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 390, height: 844 },
      }}
    >
      <Provider store={opts.store}>
        <EngineProvider engine={opts.engine}>
          <ComposerScreen navigation={navigation} route={route(opts.params)} />
        </EngineProvider>
      </Provider>
    </SafeAreaProvider>,
  );
  return { result, navigation };
}

describe("ComposerScreen", () => {
  it("note mode publishes a plain note", async () => {
    const user = userEvent.setup();
    const engine = makeEngine();
    await renderComposer({ store: makeStore(), engine }).result;

    expect(screen.getByText("New note")).toBeOnTheScreen();
    await user.type(screen.getByLabelText("Note text"), "hello wire");
    await user.press(screen.getByRole("button", { name: "Post" }));
    expect(engine.publishNote).toHaveBeenCalledWith("hello wire");
    expect(engine.publishReply).not.toHaveBeenCalled();
  });

  it("reply mode shows the target context and threads under it as root", async () => {
    const user = userEvent.setup();
    const engine = makeEngine();
    const store = makeStore();
    store.dispatch(feedEventsReceived({ context: "global", events: [rootNote] }));

    await renderComposer({
      store,
      engine,
      params: { mode: "reply", targetEventId: rootNote.id },
    }).result;

    expect(screen.getByText(/replying to/)).toBeOnTheScreen();
    expect(screen.getByText("the note being replied to")).toBeOnTheScreen();

    await user.type(screen.getByLabelText("Note text"), "good point");
    await user.press(screen.getByRole("button", { name: "Reply" }));
    expect(engine.publishReply).toHaveBeenCalledWith("good point", {
      eventId: rootNote.id,
      pubkey: rootNote.pubkey,
      rootId: undefined,
    });
    expect(engine.publishNote).not.toHaveBeenCalled();
  });

  it("replying to a nested reply threads under ITS root", async () => {
    const user = userEvent.setup();
    const engine = makeEngine();
    const store = makeStore();
    store.dispatch(feedEventsReceived({ context: "global", events: [nestedNote] }));

    await renderComposer({
      store,
      engine,
      params: { mode: "reply", targetEventId: nestedNote.id },
    }).result;

    await user.type(screen.getByLabelText("Note text"), "deep reply");
    await user.press(screen.getByRole("button", { name: "Reply" }));
    expect(engine.publishReply).toHaveBeenCalledWith("deep reply", {
      eventId: nestedNote.id,
      pubkey: nestedNote.pubkey,
      rootId: "thread-root",
    });
  });

  it("keeps Reply disabled until the target resolves", async () => {
    const engine = makeEngine();
    (engine.fetchEvents as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    await renderComposer({
      store: makeStore(),
      engine,
      params: { mode: "reply", targetEventId: "unknown-id" },
    }).result;

    expect(screen.getByText("loading note…")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  it("guests get the sign-in gate", async () => {
    const engine = makeEngine();
    await renderComposer({ store: makeStore(false), engine }).result;
    expect(screen.getByText("Posting needs an identity")).toBeOnTheScreen();
  });
});
