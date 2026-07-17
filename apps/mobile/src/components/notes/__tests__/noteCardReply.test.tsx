import { Provider } from "react-redux";
import { screen } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard } from "../NoteCard";
import type { PlatformAdapters } from "@/core/adapters";
import type { NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { renderWithTheme } from "@/test/renderWithTheme";
import { createStore } from "@/store";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const note = (over: Partial<NostrEvent>): NostrEvent => ({
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "s",
  ...over,
});

function renderCard(
  event: NostrEvent,
  opts: { parentPreview?: boolean; parentEvents?: NostrEvent[] } = {},
) {
  const store = createStore({ marker: "fake" } as unknown as PlatformAdapters);
  const engine = {
    requestProfiles: jest.fn(),
    fetchEvents: jest.fn().mockResolvedValue(opts.parentEvents ?? []),
  } as unknown as NostrEngine;
  return renderWithTheme(
    <Provider store={store}>
      <EngineProvider engine={engine}>
        <NoteCard event={event} parentPreview={opts.parentPreview} />
      </EngineProvider>
    </Provider>,
  );
}

describe("NoteCard reply indicator", () => {
  it("marks NIP-10 replies with a tappable 'replying to' line", async () => {
    const parentId = "c".repeat(64);
    await renderCard(note({ tags: [["e", parentId, "", "root"]] }));
    expect(screen.getByText(/replying to/)).toBeOnTheScreen();
  });

  it("renders no indicator on root notes", async () => {
    await renderCard(note({}));
    expect(screen.queryByText(/replying to/)).toBeNull();
  });

  it("renders no indicator on quote posts (lone mention e-tag)", async () => {
    await renderCard(note({ tags: [["e", "c".repeat(64), "", "mention"]] }));
    expect(screen.queryByText(/replying to/)).toBeNull();
  });
});

describe("NoteCard parent preview (feed surfaces)", () => {
  it("upgrades the meta line to a compact parent card when the parent resolves", async () => {
    const parentId = "5".repeat(64);
    const parent = note({ id: parentId, pubkey: "6".repeat(64), content: "the parent post" });
    await renderCard(note({ tags: [["e", parentId, "", "root"]] }), {
      parentPreview: true,
      parentEvents: [parent],
    });
    expect(await screen.findByText("the parent post")).toBeOnTheScreen();
    expect(screen.queryByText(/replying to a thread/)).toBeNull();
  });

  it("falls back to the bare line when the parent can't be resolved", async () => {
    const parentId = "7".repeat(64);
    await renderCard(note({ tags: [["e", parentId, "", "root"]] }), {
      parentPreview: true,
      parentEvents: [],
    });
    expect(await screen.findByText(/replying to a thread/)).toBeOnTheScreen();
  });
});
