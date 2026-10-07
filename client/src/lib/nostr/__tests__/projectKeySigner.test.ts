import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { nip44DecryptWithKey, nip44EncryptWithKey } from "@ishtarservices/core";
import { ProjectKeySigner } from "../projectKeySigner";

describe("ProjectKeySigner", () => {
  const sk = generateSecretKey();
  const signer = new ProjectKeySigner(sk);

  it("signs as the project key", async () => {
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
    const signed = await signer.signEvent({
      pubkey: signer.pubkey,
      created_at: 1_700_000_000,
      kind: 33123,
      tags: [["d", "basement-tapes"], ["title", "basement tapes"]],
      content: "",
    });
    expect(signed.pubkey).toBe(signer.pubkey);
    expect(verifyEvent(signed)).toBe(true);
  });

  it("refuses an event authored by another pubkey", async () => {
    await expect(
      signer.signEvent({ pubkey: "a".repeat(64), created_at: 1, kind: 1, tags: [], content: "" }),
    ).rejects.toThrow(/not this project key/);
  });

  it("NIP-44 round-trips with a peer", async () => {
    const peerSk = generateSecretKey();
    const ciphertext = await signer.nip44Encrypt(getPublicKey(peerSk), "hello");
    expect(nip44DecryptWithKey(peerSk, signer.pubkey, ciphertext)).toBe("hello");
    const reply = nip44EncryptWithKey(peerSk, signer.pubkey, "back");
    expect(await signer.nip44Decrypt(getPublicKey(peerSk), reply)).toBe("back");
  });
});
