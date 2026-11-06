import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMediaGrant, currentGrantExp } from "@/lib/media/mediaGrant";
import { SmartImage } from "../SmartImage";
import { MediaGrid } from "../MediaGrid";

vi.mock("@/lib/api/nip98", () => ({
  buildNip98Header: vi.fn(async () => "Nostr test"),
  buildAuthHeaders: vi.fn(async () => ({ Authorization: "Nostr test", "X-Wired-Client": "desktop/0.0.0-test (macos)" })),
}));
const authorServers = vi.fn(async (_pubkey: string) => ["https://author.example"]);
vi.mock("@/lib/media/authorServers", () => ({ fetchAuthorServers: (pk: string) => authorServers(pk) }));

const OWN = "http://localhost:9080";
const SHA = "ab".repeat(32);
const AUTHOR = "c".repeat(64);
const MIRROR = `https://mirror.example/${SHA}.png`;

let tokens: string[];
let mintCount: number;

beforeEach(() => {
  clearMediaGrant();
  tokens = ["T1", "T2", "T3"];
  mintCount = 0;
  authorServers.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/media-grant")) {
        const token = tokens[mintCount++] ?? "TX";
        return new Response(JSON.stringify({ data: { token, exp: currentGrantExp() } }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  clearMediaGrant();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The media element (alt="" images have no accessible role). */
function img(): HTMLImageElement {
  const el = document.querySelector("img");
  if (!el) throw new Error("no <img>");
  return el;
}

describe("media load-error chain", () => {
  it("members-only image: wait for the grant → re-mint → imeta fallback → author 10063 → unavailable tile", async () => {
    render(<SmartImage url={`${OWN}/${SHA}.png`} gated author={AUTHOR} fallbacks={[MIRROR]} />);

    // Held (no src) until the grant lands, then tokenized — no first 404.
    await waitFor(() => expect(img().getAttribute("src")).toBe(`${OWN}/${SHA}.png?tk=T1`));
    expect(mintCount).toBe(1);

    // 1. Load error → force a re-mint (past the rate limit) and retry with it.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);
    fireEvent.error(img());
    await waitFor(() => expect(img().getAttribute("src")).toBe(`${OWN}/${SHA}.png?tk=T2`));

    // 2. Then the event's fallback (a foreign host: never tokened)…
    fireEvent.error(img());
    await waitFor(() => expect(img().getAttribute("src")).toBe(MIRROR));
    expect(authorServers).toHaveBeenCalledWith(AUTHOR);

    // …then the author's kind-10063 servers, by hash.
    fireEvent.error(img());
    await waitFor(() => expect(img().getAttribute("src")).toBe(`https://author.example/${SHA}.png`));

    // 3. Nothing left: a tile, not a bare link.
    fireEvent.error(img());
    await waitFor(() => expect(screen.getByLabelText("Image unavailable")).toBeInTheDocument());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("public image on a foreign host: fallback, our server by hash (no token), author servers", async () => {
    const url = `https://gone.example/${SHA}.png`;
    render(<SmartImage url={url} author={AUTHOR} fallbacks={[MIRROR]} />);
    expect(img().getAttribute("src")).toBe(url);

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.error(img());
      });
      await waitFor(() => expect(img().getAttribute("src")).not.toBe(seen[seen.length - 1] ?? url));
      seen.push(img().getAttribute("src")!);
    }
    expect(seen).toEqual([MIRROR, `${OWN}/${SHA}.png`, `https://author.example/${SHA}.png`]);
    expect(mintCount).toBe(0); // not a space blob: no grant involved
    fireEvent.error(img());
    await waitFor(() => expect(screen.getByLabelText("Image unavailable")).toBeInTheDocument());
  });

  it("a plain non-Blossom URL that fails goes straight to the tile", async () => {
    render(<SmartImage url="https://example.com/cat.jpg" />);
    fireEvent.error(img());
    await waitFor(() => expect(screen.getByLabelText("Image unavailable")).toBeInTheDocument());
  });

  it("grid tiles run the same chain", async () => {
    render(
      <MediaGrid
        images={[
          { url: `https://gone.example/${SHA}.png`, fallbacks: [MIRROR] },
          { url: "https://example.com/b.jpg" },
        ]}
        onOpen={() => {}}
      />,
    );
    const [first, second] = Array.from(document.querySelectorAll("img"));
    fireEvent.error(first);
    await waitFor(() => expect(first.getAttribute("src")).toBe(MIRROR));
    fireEvent.error(second);
    await waitFor(() => expect(screen.getByLabelText("Image unavailable")).toBeInTheDocument());
  });
});
