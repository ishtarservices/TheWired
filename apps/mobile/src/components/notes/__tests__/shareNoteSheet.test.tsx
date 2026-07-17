import { Provider } from "react-redux";
import { screen, userEvent } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { ShareNoteSheet } from "../ShareNoteSheet";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore, type AppStore } from "@/store";
import { dmSlice } from "@/store/slices/dmSlice";
import { setIdentity } from "@/store/slices/identitySlice";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock("@/lib/api/spaces", () => ({
  fetchMySpaces: jest.fn().mockResolvedValue([]),
}));

jest.useFakeTimers();

const note: NostrEvent = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "share me",
  sig: "s",
};

function makeEngine(): NostrEngine {
  return {
    sendDM: jest.fn().mockResolvedValue(undefined),
    getSigner: () => ({}) as never,
    getAdapters: () => ({}) as never,
    requestProfiles: jest.fn(),
  } as unknown as NostrEngine;
}

function makeStore(loggedIn = true): AppStore {
  const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
  if (loggedIn) store.dispatch(setIdentity({ pubkey: "me", signerType: "local_nsec" }));
  return store;
}

function renderSheet(store: AppStore, engine: NostrEngine, target: NostrEvent | null = note) {
  return renderWithTheme(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 59, bottom: 34, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 390, height: 844 },
      }}
    >
      <Provider store={store}>
        <EngineProvider engine={engine}>
          <ShareNoteSheet target={target} onClose={() => {}} />
        </EngineProvider>
      </Provider>
    </SafeAreaProvider>,
  );
}

describe("ShareNoteSheet", () => {
  it("copy link writes a nostr:nevent reference to the clipboard", async () => {
    const clipboard = jest.requireMock("expo-clipboard") as { setStringAsync: jest.Mock };
    const user = userEvent.setup();
    await renderSheet(makeStore(), makeEngine());

    await user.press(screen.getByRole("button", { name: "Copy link" }));
    expect(clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    const written = clipboard.setStringAsync.mock.calls[0][0] as string;
    expect(written.startsWith("nostr:nevent1")).toBe(true);
  });

  it("gates DM and space rows for guests, keeps copy link open", async () => {
    await renderSheet(makeStore(false), makeEngine());

    expect(screen.getByRole("button", { name: "Send as message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share to a space" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled();
    expect(screen.getByText("Sign in to send messages")).toBeOnTheScreen();
  });

  it("forwards to an existing conversation via engine.sendDM", async () => {
    const user = userEvent.setup();
    const engine = makeEngine();
    const store = makeStore();
    store.dispatch(
      dmSlice.actions.dmMessageReceived({
        partnerPubkey: "c".repeat(64),
        myPubkey: "me",
        message: {
          id: "w1",
          senderPubkey: "c".repeat(64),
          content: "yo",
          createdAt: 1_700_000_000,
          wrapId: "w1",
        },
      }),
    );

    await renderSheet(store, engine);
    await user.press(screen.getByRole("button", { name: "Send as message" }));
    await user.press(screen.getByText("yo"));

    expect(engine.sendDM).toHaveBeenCalledTimes(1);
    const [peer, content] = (engine.sendDM as jest.Mock).mock.calls[0];
    expect(peer).toBe("c".repeat(64));
    expect((content as string).startsWith("nostr:nevent1")).toBe(true);
  });
});
