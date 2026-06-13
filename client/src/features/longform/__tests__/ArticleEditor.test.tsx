import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addSpace, setChannels } from "@/store/slices/spacesSlice";
import { ArticleEditor } from "../ArticleEditor";
import { getDB } from "@/lib/db/database";
import { getDraftsForAccount, upsertDraft } from "@/lib/db/articleDraftStore";
import type { Space, SpaceChannel } from "@/types/space";

// Mock the publish layer so no signing/relay I/O happens; capture the call.
const { signAndPublishMock } = vi.hoisted(() => ({ signAndPublishMock: vi.fn() }));
vi.mock("@/lib/nostr/publish", () => ({
  signAndPublish: signAndPublishMock,
  signAndSaveLocally: vi.fn(),
  publishExisting: vi.fn(),
}));

// Stub the lazy WYSIWYG surface: ProseMirror needs real contentEditable DOM,
// which jsdom doesn't fully support. The body is exercised via Markdown mode.
vi.mock("../RichArticleEditor", () => ({
  RichArticleEditor: ({ value }: { value: string }) => <div data-testid="rich-stub">{value}</div>,
}));

const PK = "1".repeat(64);
const HOST = "wss://relay.example.com";

function makeSpace(): Space {
  return {
    id: "space-abc",
    hostRelay: HOST,
    name: "Test Space",
    isPrivate: false,
    adminPubkeys: [PK],
    memberPubkeys: [PK],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: PK,
    createdAt: 1,
  };
}

function makeArticlesChannel(over: Partial<SpaceChannel> = {}): SpaceChannel {
  return {
    id: "chan-articles",
    spaceId: "space-abc",
    type: "articles",
    label: "Articles",
    position: 0,
    isDefault: true,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...over,
  };
}

function renderEditor(props?: Partial<Parameters<typeof ArticleEditor>[0]>) {
  const onPublished = vi.fn();
  const onCancel = vi.fn();
  render(
    <Provider store={store}>
      <ArticleEditor mode="new" onPublished={onPublished} onCancel={onCancel} {...props} />
    </Provider>,
  );
  return { onPublished, onCancel };
}

function fillTitleAndBody() {
  fireEvent.change(screen.getByPlaceholderText("Article title"), {
    target: { value: "My Title" },
  });
  // Switch to Markdown mode to edit the body via a plain textarea.
  fireEvent.click(screen.getByTitle("Markdown"));
  fireEvent.change(screen.getByPlaceholderText(/Write your article here/i), {
    target: { value: "Hello body" },
  });
}

beforeEach(async () => {
  localStorage.clear();
  const db = await getDB();
  await db.clear("articleDrafts");
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: PK, signerType: "nip07" }));
  signAndPublishMock.mockReset();
  signAndPublishMock.mockImplementation(async (u: { tags: string[][] }) => ({
    ...u,
    id: "e".repeat(64),
    sig: "s",
  }));
});

afterEach(() => {
  store.dispatch(resetAll());
});

describe("ArticleEditor — publishing", () => {
  it("publishes a public kind:30023 to all write relays (no target relays)", async () => {
    const { onPublished } = renderEditor();
    fillTitleAndBody();
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    const [unsigned, targetRelays] = signAndPublishMock.mock.calls[0];
    expect(unsigned.kind).toBe(30023);
    expect(unsigned.content).toBe("Hello body");
    expect(unsigned.tags).toContainEqual(["title", "My Title"]);
    expect(unsigned.tags.some((t: string[]) => t[0] === "h")).toBe(false);
    expect(targetRelays).toBeUndefined();
    await waitFor(() => expect(onPublished).toHaveBeenCalled());
  });

  it("prefills from an external seed (e.g. AI output) and publishes it", async () => {
    renderEditor({ seed: { title: "AI Title", content: "Body written by the assistant" } });

    expect((screen.getByPlaceholderText("Article title") as HTMLInputElement).value).toBe("AI Title");
    fireEvent.click(screen.getByTitle("Markdown"));
    expect(
      (screen.getByPlaceholderText(/Write your article here/i) as HTMLTextAreaElement).value,
    ).toBe("Body written by the assistant");

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    const [unsigned] = signAndPublishMock.mock.calls[0];
    expect(unsigned.tags).toContainEqual(["title", "AI Title"]);
    expect(unsigned.content).toBe("Body written by the assistant");
  });

  it("an AI seed neither autosaves its own draft nor deletes existing ones on publish", async () => {
    // A real, hand-written draft already exists for this account.
    await upsertDraft(
      PK,
      "manual-1",
      {
        title: "My manual draft",
        summary: "",
        image: "",
        tags: "",
        content: "manual work in progress",
        visibility: "public",
        spaceId: "",
        channelId: "",
      },
      1,
    );

    renderEditor({ seed: { title: "AI", content: "ai body" } });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));

    // The manual draft survives, and the AI-seeded session created none of its own.
    const drafts = await getDraftsForAccount(PK);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("manual-1");
    expect(drafts[0].title).toBe("My manual draft");
  });

  it("autosaves the editing session to its own draft record", async () => {
    renderEditor();
    fillTitleAndBody(); // title "My Title", body "Hello body" (via Markdown mode)

    await waitFor(
      async () => {
        const drafts = await getDraftsForAccount(PK);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].title).toBe("My Title");
        expect(drafts[0].content).toBe("Hello body");
      },
      { timeout: 2000 },
    );
  });

  it("deletes the active draft record after a successful publish", async () => {
    renderEditor();
    fillTitleAndBody();
    // Let the debounced autosave write the record first.
    await waitFor(async () => expect(await getDraftsForAccount(PK)).toHaveLength(1), {
      timeout: 2000,
    });

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await getDraftsForAccount(PK)).toHaveLength(0));
  });

  it("renders a live preview of typed markdown", () => {
    renderEditor();
    fireEvent.click(screen.getByTitle("Markdown"));
    fireEvent.change(screen.getByPlaceholderText(/Write your article here/i), {
      target: { value: "# Heading\n\n**bold**" },
    });
    fireEvent.click(screen.getByTitle("Preview"));
    expect(screen.getByText("Heading").tagName.toLowerCase()).toBe("h1");
    expect(screen.getByText("bold").tagName.toLowerCase()).toBe("strong");
  });

  it("BLOCKS a space-exclusive publish when no space is selected (leak guard)", async () => {
    renderEditor();
    fillTitleAndBody();
    // Choose space-exclusive but pick no space.
    fireEvent.click(screen.getByRole("button", { name: /space-exclusive/i }));
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    expect(await screen.findByText(/choose a space/i)).not.toBeNull();
    expect(signAndPublishMock).not.toHaveBeenCalled();
  });

  it("publishes a space-exclusive article only to the space host relay, with an h tag", async () => {
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setChannels({ spaceId: "space-abc", channels: [makeArticlesChannel()] }));

    renderEditor();
    fillTitleAndBody();
    fireEvent.click(screen.getByRole("button", { name: /space-exclusive/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "space-abc" } });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    const [unsigned, targetRelays] = signAndPublishMock.mock.calls[0];
    expect(targetRelays).toEqual([HOST]);
    expect(unsigned.tags).toContainEqual(["h", "space-abc"]);
  });

  it("defaults to the space + channel you started from (context-aware)", async () => {
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(setChannels({ spaceId: "space-abc", channels: [makeArticlesChannel()] }));

    renderEditor({ initialSpaceId: "space-abc", initialChannelId: "chan-articles" });
    fillTitleAndBody();

    // Visibility already defaulted to space, with the space preselected.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("space-abc");

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    const [unsigned, targetRelays] = signAndPublishMock.mock.calls[0];
    expect(targetRelays).toEqual([HOST]);
    expect(unsigned.tags).toContainEqual(["h", "space-abc"]);
    expect(unsigned.tags).toContainEqual(["channel", "chan-articles"]);
  });

  it("auto-resolves to the space's default articles channel when none is specified", async () => {
    store.dispatch(addSpace(makeSpace()));
    store.dispatch(
      setChannels({
        spaceId: "space-abc",
        channels: [
          makeArticlesChannel({ id: "chan-a", label: "General", isDefault: false }),
          makeArticlesChannel({ id: "chan-default", label: "Featured", isDefault: true }),
        ],
      }),
    );

    // Space preselected, but no channel passed → should fall to the default channel.
    renderEditor({ initialSpaceId: "space-abc" });
    fillTitleAndBody();
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => expect(signAndPublishMock).toHaveBeenCalledTimes(1));
    const [unsigned] = signAndPublishMock.mock.calls[0];
    expect(unsigned.tags).toContainEqual(["channel", "chan-default"]);
  });

  it("omits read-only spaces from the picker (never prompts a read-only space)", () => {
    store.dispatch(addSpace(makeSpace())); // writable
    store.dispatch(addSpace({ ...makeSpace(), id: "ro", name: "Read Only", mode: "read" }));

    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /space-exclusive/i }));
    const options = Array.from(
      (screen.getByRole("combobox") as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options).toContain("Test Space");
    expect(options).not.toContain("Read Only");
  });

  it("won't publish without a title", () => {
    renderEditor();
    fireEvent.click(screen.getByTitle("Markdown"));
    fireEvent.change(screen.getByPlaceholderText(/Write your article here/i), {
      target: { value: "body only" },
    });
    // Publish is disabled until both title and content are present.
    expect((screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
