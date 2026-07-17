import { Provider } from "react-redux";
import { screen } from "@testing-library/react-native";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteText } from "../NoteText";
import { clearEmbedCacheForTests } from "../useEmbeddedEvent";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore, type AppStore } from "@/store";
import { profileReceived } from "@/store/slices/profilesSlice";

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const AUTHOR = "a".repeat(64);
const EMBED_ID = "b".repeat(64);

const embeddedNote: NostrEvent = {
  id: EMBED_ID,
  pubkey: AUTHOR,
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "inner content",
  sig: "s",
};

function makeEngine(fetchResult: NostrEvent[] = []): NostrEngine {
  return {
    requestProfiles: jest.fn(),
    fetchEvents: jest.fn().mockResolvedValue(fetchResult),
  } as unknown as NostrEngine;
}

function makeStore(): AppStore {
  return createStore({ marker: "fake" } as unknown as PlatformAdapters);
}

function renderNoteText(content: string, engine: NostrEngine, store: AppStore = makeStore()) {
  return renderWithTheme(
    <Provider store={store}>
      <EngineProvider engine={engine}>
        <NoteText content={content} />
      </EngineProvider>
    </Provider>,
  );
}

beforeEach(() => {
  clearEmbedCacheForTests();
});

describe("NoteText", () => {
  it("renders mentions with the shortened-pubkey fallback and backfills the profile", async () => {
    const engine = makeEngine();
    await renderNoteText(`hello nostr:${nip19.npubEncode(AUTHOR)}!`, engine);

    expect(screen.getByText(`@${AUTHOR.slice(0, 8)}…`, { exact: false })).toBeOnTheScreen();
    expect(engine.requestProfiles).toHaveBeenCalledWith([AUTHOR]);
  });

  it("resolves mention display names from the profiles slice", async () => {
    const store = makeStore();
    store.dispatch(
      profileReceived({
        pubkey: AUTHOR,
        profile: { name: "luna", created_at: 1 },
      }),
    );
    await renderNoteText(`hi nostr:${nip19.npubEncode(AUTHOR)}`, makeEngine(), store);
    expect(screen.getByText("@luna", { exact: false })).toBeOnTheScreen();
  });

  it("renders an event ref as an embedded card — never the raw bech32", async () => {
    const nevent = nip19.neventEncode({ id: EMBED_ID });
    const engine = makeEngine([embeddedNote]);
    await renderNoteText(`check this out nostr:${nevent}`, engine);

    expect(await screen.findByText("inner content")).toBeOnTheScreen();
    expect(screen.queryByText(/nevent1/)).toBeNull();
    expect(engine.fetchEvents).toHaveBeenCalledWith([{ ids: [EMBED_ID] }]);
  });

  it("shows 'note unavailable' when the fetch comes back empty", async () => {
    const nevent = nip19.neventEncode({ id: EMBED_ID });
    await renderNoteText(`gone: nostr:${nevent}`, makeEngine([]));

    expect(await screen.findByText("note unavailable")).toBeOnTheScreen();
    expect(screen.queryByText(/nevent1/)).toBeNull();
  });

  it("depth-guards nested refs: an embedded note's own ref renders as a link, not a card", async () => {
    const innerRef = nip19.neventEncode({ id: "c".repeat(64) });
    const nesting: NostrEvent = { ...embeddedNote, content: `nested nostr:${innerRef}` };
    const engine = makeEngine([nesting]);
    await renderNoteText(`outer nostr:${nip19.neventEncode({ id: EMBED_ID })}`, engine);

    expect(await screen.findByText("↗ note")).toBeOnTheScreen();
    // Only the outer ref fetched — the nested one must not recurse.
    expect(engine.fetchEvents).toHaveBeenCalledTimes(1);
  });

  it("renders a share consisting solely of a ref with no empty text line", async () => {
    const engine = makeEngine([embeddedNote]);
    await renderNoteText(`nostr:${nip19.neventEncode({ id: EMBED_ID })}`, engine);

    expect(await screen.findByText("inner content")).toBeOnTheScreen();
    expect(screen.queryByText(/nostr:/)).toBeNull();
  });
});
