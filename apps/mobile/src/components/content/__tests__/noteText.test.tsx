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

  it("renders a quote-of-a-quote as a nested compact card (desktop parity)", async () => {
    const INNER_ID = "c".repeat(64);
    const innerNote: NostrEvent = {
      ...embeddedNote,
      id: INNER_ID,
      content: "innermost quote",
    };
    const nesting: NostrEvent = {
      ...embeddedNote,
      content: `nested nostr:${nip19.neventEncode({ id: INNER_ID })}`,
    };
    const engine = {
      requestProfiles: jest.fn(),
      // First fetch resolves the outer embed, second the nested one.
      fetchEvents: jest
        .fn()
        .mockResolvedValueOnce([nesting])
        .mockResolvedValueOnce([innerNote]),
    } as unknown as NostrEngine;
    await renderNoteText(`outer nostr:${nip19.neventEncode({ id: EMBED_ID })}`, engine);

    // The inner quote SHOWS as a card, not a bare link.
    expect(await screen.findByText("innermost quote")).toBeOnTheScreen();
    expect(screen.queryByText("↗ note")).toBeNull();
    expect(engine.fetchEvents).toHaveBeenCalledTimes(2);
  });

  it("depth-guards at level two: the innermost ref renders as a link, never fetched", async () => {
    const DEEPEST = "d".repeat(64);
    const INNER_ID = "c".repeat(64);
    const inner: NostrEvent = {
      ...embeddedNote,
      id: INNER_ID,
      content: `deeper nostr:${nip19.neventEncode({ id: DEEPEST })}`,
    };
    const outer: NostrEvent = {
      ...embeddedNote,
      content: `nested nostr:${nip19.neventEncode({ id: INNER_ID })}`,
    };
    const engine = {
      requestProfiles: jest.fn(),
      fetchEvents: jest
        .fn()
        .mockResolvedValueOnce([outer])
        .mockResolvedValueOnce([inner]),
    } as unknown as NostrEngine;
    await renderNoteText(`outer nostr:${nip19.neventEncode({ id: EMBED_ID })}`, engine);

    expect(await screen.findByText("↗ note")).toBeOnTheScreen();
    // Outer + nested fetched; the depth-2 ref must not recurse further.
    expect(engine.fetchEvents).toHaveBeenCalledTimes(2);
  });

  it("renders a share consisting solely of a ref with no empty text line", async () => {
    const engine = makeEngine([embeddedNote]);
    await renderNoteText(`nostr:${nip19.neventEncode({ id: EMBED_ID })}`, engine);

    expect(await screen.findByText("inner content")).toBeOnTheScreen();
    expect(screen.queryByText(/nostr:/)).toBeNull();
  });
});
