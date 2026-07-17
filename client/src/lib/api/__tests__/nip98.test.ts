import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyEvent, type Event } from "nostr-tools";
import { buildNip98Header } from "../nip98";

// Real signing (nostr-tools finalizeEvent) behind the loginFlow seam — the
// regression under test is the event-id hash, so the signer must be genuine.
vi.mock("@/lib/nostr/loginFlow", async () => {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import("nostr-tools");
  const sk = generateSecretKey();
  return {
    getSigner: () => ({
      getPublicKey: () => Promise.resolve(getPublicKey(sk)),
      signEvent: (event: import("nostr-tools").EventTemplate) =>
        Promise.resolve(finalizeEvent(event, sk)),
    }),
  };
});

function decode(header: string): Event {
  expect(header.startsWith("Nostr ")).toBe(true);
  return JSON.parse(atob(header.slice("Nostr ".length))) as Event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildNip98Header", () => {
  it("signs a kind-27235 event with exact u/method tags", async () => {
    const url = "https://api.thewired.app/api/music/upload";
    const header = await buildNip98Header(url, "post");
    const decoded = decode(header);

    expect(decoded.kind).toBe(27235);
    expect(decoded.tags).toContainEqual(["u", url]);
    expect(decoded.tags).toContainEqual(["method", "POST"]);
    expect(decoded.content).toBe("");
    expect(Math.abs(decoded.created_at - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5);
    expect(verifyEvent(decoded)).toBe(true);
  });

  it("adds a unique nonce so parallel same-second requests get distinct event ids", async () => {
    const url = "https://api.thewired.app/api/music/upload";
    // Pin the clock: identical created_at is exactly the collision that made
    // the gateway's single-use replay guard 401 parallel batch uploads.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const [first, second] = await Promise.all([
      buildNip98Header(url, "POST"),
      buildNip98Header(url, "POST"),
    ]);
    const a = decode(first);
    const b = decode(second);

    expect(a.created_at).toBe(b.created_at);
    const nonceA = a.tags.find((t) => t[0] === "nonce")?.[1];
    const nonceB = b.tags.find((t) => t[0] === "nonce")?.[1];
    expect(nonceA).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceB).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceA).not.toBe(nonceB);
    expect(a.id).not.toBe(b.id);
    // Still verifiable — the gateway ignores unknown tags but re-hashes them all.
    expect(verifyEvent(a)).toBe(true);
    expect(verifyEvent(b)).toBe(true);
  });
});
