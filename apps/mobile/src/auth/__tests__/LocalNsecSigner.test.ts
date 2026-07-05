import { verifyEvent } from "nostr-tools";

import { generateIdentity } from "../keys";
import { LocalNsecSigner } from "../LocalNsecSigner";
import type { UnsignedEvent } from "@thewired/shared-types";

function template(pubkey: string): UnsignedEvent {
  return {
    pubkey,
    kind: 1,
    created_at: 1_700_000_000,
    tags: [["t", "test"]],
    content: "hello from mobile",
  };
}

describe("LocalNsecSigner", () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const signer = new LocalNsecSigner(alice.secretKey);

  it("reports the derived pubkey", async () => {
    await expect(signer.getPublicKey()).resolves.toBe(alice.pubkey);
  });

  it("signs a schnorr-valid event with correct id", async () => {
    const event = await signer.signEvent(template(alice.pubkey));
    expect(event.pubkey).toBe(alice.pubkey);
    expect(event.kind).toBe(1);
    expect(event.content).toBe("hello from mobile");
    expect(verifyEvent(event)).toBe(true);
  });

  it("refuses to sign for a different pubkey", async () => {
    await expect(signer.signEvent(template(bob.pubkey))).rejects.toThrow(
      /does not match/,
    );
  });

  it("nip44 roundtrips between two parties", async () => {
    const bobSigner = new LocalNsecSigner(bob.secretKey);
    const ciphertext = await signer.nip44Encrypt(bob.pubkey, "sealed for bob");
    expect(ciphertext).not.toContain("sealed for bob");
    await expect(bobSigner.nip44Decrypt(alice.pubkey, ciphertext)).resolves.toBe(
      "sealed for bob",
    );
  });

  it("nip44 decrypt fails for a third party", async () => {
    const eve = new LocalNsecSigner(generateIdentity().secretKey);
    const ciphertext = await signer.nip44Encrypt(bob.pubkey, "not for eve");
    await expect(eve.nip44Decrypt(alice.pubkey, ciphertext)).rejects.toThrow();
  });
});
