import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { clearMediaGrant, currentGrantExp, ensureMediaGrant } from "@/lib/media/mediaGrant";
import { EmbedDepthContext } from "../embedDepth";
import { RichContent } from "../RichContent";
import type { NostrEvent } from "@/types/nostr";

vi.mock("@/lib/api/nip98", () => ({
  buildNip98Header: vi.fn(async () => "Nostr test"),
  buildAuthHeaders: vi.fn(async () => ({ Authorization: "Nostr test", "X-Wired-Client": "desktop/0.0.0-test (macos)" })),
}));
vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));

const OWN = "http://localhost:9080";
const SHA = "ab".repeat(32);
const TOKEN = "v1.pk.99.cafe";
const SPACE_A_MESSAGE: NostrEvent = {
  id: "9".repeat(64),
  pubkey: "e".repeat(64),
  created_at: 1_700_000_000,
  kind: 9,
  tags: [["h", "space-a"]],
  content: `from space A ${OWN}/${SHA}.png`,
  sig: "0".repeat(128),
};

vi.mock("../useEmbeddedEvent", () => ({
  useEmbeddedEvent: () => ({ event: SPACE_A_MESSAGE, loading: false, notFound: false }),
}));

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/media-grant")
        ? new Response(JSON.stringify({ token: TOKEN, exp: currentGrantExp() }), { status: 200 })
        : new Response(null, { status: 404 }),
    ),
  );
  expect(await ensureMediaGrant()).toBe(TOKEN);
});

afterAll(() => {
  clearMediaGrant();
  vi.unstubAllGlobals();
});

const nevent = `nostr:${nip19.neventEncode({ id: SPACE_A_MESSAGE.id })}`;
const tokened = `${OWN}/${SHA}.png?tk=${encodeURIComponent(TOKEN)}`;

function imgSrcs(): string[] {
  return Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "");
}

describe("embedded space message keeps its own space's grant", () => {
  it.each<[string, { tags: string[][]; pubkey: string } | undefined]>([
    ["a public note", { tags: [], pubkey: "a".repeat(64) }],
    ["a message in space B", { tags: [["h", "space-b"]], pubkey: "a".repeat(64) }],
    ["a DM (no event context)", undefined],
  ])("quoted in %s", async (_name, parent) => {
    renderWithProviders(
      // Depth 1: the compact card (no engagement bar) — the media path is the same.
      <EmbedDepthContext.Provider value={1}>
        <RichContent content={`see ${nevent}`} event={parent} />
      </EmbedDepthContext.Provider>,
    );
    await waitFor(() => expect(imgSrcs()).toContain(tokened));
  });
});

describe("RichContent media", () => {
  it("a public note's own-origin image renders untokened", () => {
    renderWithProviders(<RichContent content={`${OWN}/${SHA}.png`} event={{ tags: [], pubkey: "a".repeat(64) }} />);
    expect(imgSrcs()).toEqual([`${OWN}/${SHA}.png`]);
  });

  it("an extensionless blob URL with imeta m renders as an image", () => {
    const url = `${OWN}/${SHA}`;
    renderWithProviders(
      <RichContent content={url} event={{ tags: [["imeta", `url ${url}`, "m image/webp"]], pubkey: "a".repeat(64) }} />,
    );
    expect(imgSrcs()).toEqual([url]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a pdf link keeps the token out of its href", () => {
    const url = `${OWN}/${SHA}.pdf`;
    renderWithProviders(<RichContent content={url} event={{ tags: [["h", "space-a"]], pubkey: "a".repeat(64) }} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(url);
  });
});
