import { Provider } from "react-redux";
import { screen } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { ChatMessageRow } from "../components/ChatMessageRow";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore } from "@/store";
import { profileReceived } from "@/store/slices/profilesSlice";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const SENDER = "b".repeat(64);

const message = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: "a".repeat(64),
  pubkey: SENDER,
  created_at: 1_700_000_000,
  kind: 9,
  tags: [["h", "space-1"]],
  content: "hello channel",
  sig: "s",
  ...over,
});

async function renderRow(event: NostrEvent, grouped = false) {
  const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
  const engine = {
    requestProfiles: jest.fn(),
    fetchEvents: jest.fn().mockResolvedValue([]),
  } as unknown as NostrEngine;
  await renderWithTheme(
    <Provider store={store}>
      <EngineProvider engine={engine}>
        <ChatMessageRow
          event={event}
          grouped={grouped}
          onLongPress={jest.fn()}
          onPressAuthor={jest.fn()}
        />
      </EngineProvider>
    </Provider>,
  );
  return store;
}

const lunaKind0 = {
  pubkey: SENDER,
  profile: { name: "luna", display_name: "Luna Vega", created_at: 1 },
};

describe("ChatMessageRow", () => {
  it("renders the pubkey-stub name and content before the kind-0 arrives", async () => {
    await renderRow(message());
    expect(screen.getByText(`${SENDER.slice(0, 8)}…`)).toBeOnTheScreen();
    expect(screen.getByText("hello channel")).toBeOnTheScreen();
  });

  it("picks up its sender's profile from the store (narrow selector)", async () => {
    const store = await renderRow(message());
    store.dispatch(profileReceived(lunaKind0));
    expect(await screen.findByText("Luna Vega")).toBeOnTheScreen();
  });

  it("grouped rows render content only — no name header", async () => {
    const store = await renderRow(message(), true);
    store.dispatch(profileReceived(lunaKind0));
    expect(await screen.findByText("hello channel")).toBeOnTheScreen();
    expect(screen.queryByText("Luna Vega")).toBeNull();
  });
});
