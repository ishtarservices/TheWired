import { describe, it, expect, vi } from "vitest";
import { generateSecretKey, verifyEvent } from "nostr-tools/pure";

vi.mock("@/lib/nostr/loginFlow", () => ({ getSigner: () => null }));

import { buildNip98Header } from "../nip98";
import { buildBlossomAuthHeader } from "../blossomAuth";
import { ProjectKeySigner } from "@/lib/nostr/projectKeySigner";

function decodeHeader(header: string) {
  expect(header.startsWith("Nostr ")).toBe(true);
  return JSON.parse(atob(header.slice("Nostr ".length)));
}

describe("auth headers with an explicit signer", () => {
  const signer = new ProjectKeySigner(generateSecretKey());

  it("NIP-98 signs as the given key, without an account signer", async () => {
    const event = decodeHeader(await buildNip98Header("https://api.example/music/upload", "post", { signer }));
    expect(event.kind).toBe(27235);
    expect(event.pubkey).toBe(signer.pubkey);
    expect(event.tags).toEqual(expect.arrayContaining([["u", "https://api.example/music/upload"], ["method", "POST"]]));
    expect(verifyEvent(event)).toBe(true);
  });

  it("Blossom auth signs as the given key", async () => {
    const event = decodeHeader(await buildBlossomAuthHeader("upload", "f".repeat(64), undefined, { signer }));
    expect(event.kind).toBe(24242);
    expect(event.pubkey).toBe(signer.pubkey);
    expect(verifyEvent(event)).toBe(true);
  });

  it("still needs an account signer when none is given", async () => {
    await expect(buildNip98Header("https://api.example/x", "GET")).rejects.toThrow(/No signer/);
  });
});
