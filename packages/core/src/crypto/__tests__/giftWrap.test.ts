import { describe, it, expect } from "vitest";
import {
  buildRumor,
  createGiftWrappedDM,
  createSelfWrap,
  unwrapGiftWrap,
  type GiftWrapContext,
} from "../giftWrap";
import { verifyEventSync } from "../verifyEvent";
import { KIND_GIFT_WRAP } from "../../kinds";
import { makeTestIdentity } from "./testSigner";

function ctxOf(id: ReturnType<typeof makeTestIdentity>): GiftWrapContext {
  return { myPubkey: id.pubkey, signer: id.signer };
}

describe("gift wrap round trip", () => {
  it("alice → bob: bob unwraps to the original rumor", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();

    const { wrap, rumorId } = await createGiftWrappedDM(
      ctxOf(alice),
      "hello bob",
      bob.pubkey,
    );

    // The wrap is a valid, ephemeral-signed kind:1059 addressed to bob
    expect(wrap.kind).toBe(KIND_GIFT_WRAP);
    expect(wrap.pubkey).not.toBe(alice.pubkey);
    expect(wrap.tags).toContainEqual(["p", bob.pubkey]);
    expect(verifyEventSync(wrap)).toBe(true);

    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.sender).toBe(alice.pubkey);
    expect(dm.content).toBe("hello bob");
    expect(dm.rumorId).toBe(rumorId);
    expect(dm.wrapId).toBe(wrap.id);
    expect(dm.tags).toContainEqual(["p", bob.pubkey]);
  });

  it("self wrap shares the rumor id and unwraps with the sender's own key", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();

    const rumor = await buildRumor(alice.pubkey, bob.pubkey, "note to self");
    const recipient = await createGiftWrappedDM(ctxOf(alice), "note to self", bob.pubkey, undefined, rumor);
    const self = await createSelfWrap(ctxOf(alice), "note to self", bob.pubkey, undefined, rumor);

    expect(self.rumorId).toBe(recipient.rumorId);
    expect(self.wrap.tags).toContainEqual(["p", alice.pubkey]);

    const dm = await unwrapGiftWrap(alice.signer, self.wrap);
    expect(dm.sender).toBe(alice.pubkey);
    expect(dm.content).toBe("note to self");
    expect(dm.rumorId).toBe(recipient.rumorId);
  });

  it("extra tags ride along on the rumor", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "re: that", bob.pubkey, [
      ["q", "e".repeat(64)],
    ]);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.tags).toContainEqual(["q", "e".repeat(64)]);
  });

  it("seal/wrap timestamps are randomized into the past; the rumor keeps real time", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const now = Math.round(Date.now() / 1000);
    const TWO_DAYS = 2 * 24 * 60 * 60;

    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "when?", bob.pubkey);
    expect(wrap.created_at).toBeLessThanOrEqual(now + 1);
    expect(wrap.created_at).toBeGreaterThanOrEqual(now - TWO_DAYS - 5);

    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(Math.abs(dm.createdAt - now)).toBeLessThanOrEqual(5);
  });

  it("a third party cannot unwrap (fails closed)", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const eve = makeTestIdentity();

    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "secret", bob.pubkey);
    await expect(unwrapGiftWrap(eve.signer, wrap)).rejects.toThrow();
  });

  it("rejects a seal-as-rumor confusion (kind mismatch fails closed)", async () => {
    const bob = makeTestIdentity();
    // A codec that "decrypts" everything to a kind:13 object simulates a
    // wrong-key NIP-07 decrypt that returns parseable garbage.
    const badCodec = {
      nip44Decrypt: async () =>
        JSON.stringify({ pubkey: "a".repeat(64), created_at: 1, kind: 13, tags: [], content: "x" }),
    };
    const fakeWrap = {
      id: "f".repeat(64),
      pubkey: "b".repeat(64),
      created_at: 1,
      kind: KIND_GIFT_WRAP,
      tags: [["p", bob.pubkey]],
      content: "ciphertext",
      sig: "0".repeat(128),
    };
    await expect(unwrapGiftWrap(badCodec, fakeWrap, { verifySeal: false })).rejects.toThrow(/kind/);
  });

  it("rejects rumor content that still looks like base64 ciphertext", async () => {
    const codec = {
      nip44Decrypt: async (_peer: string, ct: string) => {
        if (ct === "outer") {
          return JSON.stringify({ pubkey: "a".repeat(64), created_at: 1, kind: 13, tags: [], content: "inner" });
        }
        return JSON.stringify({
          pubkey: "a".repeat(64),
          created_at: 1,
          kind: 14,
          tags: [],
          content: "QUJDRA==".repeat(10), // 80 chars of pure base64
        });
      },
    };
    const fakeWrap = {
      id: "f".repeat(64),
      pubkey: "b".repeat(64),
      created_at: 1,
      kind: KIND_GIFT_WRAP,
      tags: [],
      content: "outer",
      sig: "0".repeat(128),
    };
    await expect(unwrapGiftWrap(codec, fakeWrap, { verifySeal: false })).rejects.toThrow(/encrypted/);
  });
});

describe("wire_version 1 hardening", () => {
  it("returns the rumor kind and a recomputed rumor id", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const { wrap, rumorId } = await createGiftWrappedDM(ctxOf(alice), "k", bob.pubkey);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.kind).toBe(14);
    expect(dm.rumorId).toBe(rumorId);
    expect(dm.expiration).toBeUndefined();
  });

  it("rejects a seal whose signature was forged", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const mallory = makeTestIdentity();
    // Mallory builds a seal claiming to be alice but signs with her own key,
    // then wraps it for bob with an ephemeral key. Bob must refuse it.
    const rumor = await buildRumor(alice.pubkey, bob.pubkey, "not from alice");
    // Seal content must decrypt with alice's conversation key for the rumor
    // step to be reachable; use alice's codec to produce it (the attacker
    // scenario is a leaked ciphertext, not a leaked key).
    const encryptedRumor = await alice.signer.nip44Encrypt(bob.pubkey, JSON.stringify(rumor));
    const sealFromMallory = await mallory.signer.signEvent({
      pubkey: alice.pubkey, // claims alice
      created_at: Math.floor(Date.now() / 1000),
      kind: 13,
      tags: [],
      content: encryptedRumor,
    } as never);
    const { generateSecretKey, getPublicKey, finalizeEvent } = await import("nostr-tools/pure");
    const { nip44EncryptWithKey } = await import("../nip44");
    const esk = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: KIND_GIFT_WRAP,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", bob.pubkey]],
        content: nip44EncryptWithKey(esk, bob.pubkey, JSON.stringify({ ...sealFromMallory, pubkey: alice.pubkey })),
      },
      esk,
    );
    expect(getPublicKey(esk)).toBe(wrap.pubkey);
    await expect(unwrapGiftWrap(bob.signer, wrap as never)).rejects.toThrow(/Seal signature/);
  });

  it("rejects a rumor whose embedded id does not match its contents", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const rumor = await buildRumor(alice.pubkey, bob.pubkey, "anchor me");
    const tampered = { ...rumor, id: "0".repeat(64) };
    const encryptedRumor = await alice.signer.nip44Encrypt(bob.pubkey, JSON.stringify(tampered));
    const seal = await alice.signer.signEvent({
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 13,
      tags: [],
      content: encryptedRumor,
    } as never);
    const { generateSecretKey, finalizeEvent } = await import("nostr-tools/pure");
    const { nip44EncryptWithKey } = await import("../nip44");
    const esk = generateSecretKey();
    const wrap = finalizeEvent(
      { kind: KIND_GIFT_WRAP, created_at: 1, tags: [["p", bob.pubkey]], content: nip44EncryptWithKey(esk, bob.pubkey, JSON.stringify(seal)) },
      esk,
    );
    await expect(unwrapGiftWrap(bob.signer, wrap as never)).rejects.toThrow(/id mismatch/);
  });

  it("accepts kind 15 and kind 7 rumors and refuses kinds outside the allowlist", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    for (const kind of [15, 7, 20014, 20015]) {
      const rumor = await buildRumor(alice.pubkey, bob.pubkey, "x", undefined, { kind });
      const { wrap } = await createGiftWrappedDM(ctxOf(alice), "x", bob.pubkey, undefined, rumor);
      const dm = await unwrapGiftWrap(bob.signer, wrap);
      expect(dm.kind).toBe(kind);
    }
    const odd = await buildRumor(alice.pubkey, bob.pubkey, "x", undefined, { kind: 1 });
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "x", bob.pubkey, undefined, odd);
    await expect(unwrapGiftWrap(bob.signer, wrap)).rejects.toThrow(/Unsupported rumor kind/);
    const dm = await unwrapGiftWrap(bob.signer, wrap, { acceptKinds: [1] });
    expect(dm.kind).toBe(1);
  });

  it("puts expiration on seal + wrap and drops the wrap once expired", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const now = Math.floor(Date.now() / 1000);
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "typing", bob.pubkey, undefined, undefined, {
      expiration: now + 30,
    });
    expect(wrap.tags).toContainEqual(["expiration", String(now + 30)]);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.expiration).toBe(now + 30);
    await expect(unwrapGiftWrap(bob.signer, wrap, { now: now + 31 })).rejects.toThrow(/expired/);
    // The seal carries it too (checked by decrypting with the wrap dropped)
    const sealJson = await bob.signer.nip44Decrypt(wrap.pubkey, wrap.content);
    expect(JSON.parse(sealJson).tags).toContainEqual(["expiration", String(now + 30)]);
  });
});
