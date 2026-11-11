import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildRumor,
  createGiftWrappedDM,
  createSelfWrap,
  unwrapGiftWrap,
  GiftWrapRejectedError,
  isTransientCodecFailure,
  SEAL_TTL_SLACK_SEC,
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

  it("delivers a body that is only an npub (63 chars of bech32)", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const body = "npub1" + "q".repeat(58); // 63 chars, all in the base64 alphabet
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), body, bob.pubkey);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.content).toBe(body);
  });

  it("delivers a body that is a bare 64-hex event id", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const body = "deadbeef".repeat(8);
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), body, bob.pubkey);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.content).toBe(body);
  });

  it("delivers a 60-character laugh", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const body = "ha".repeat(30);
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), body, bob.pubkey);
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.content).toBe(body);
  });

  it("a wrong key fails at the NIP-44 MAC, not at a content heuristic", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const mallory = makeTestIdentity();
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "QUJDRA==".repeat(10), bob.pubkey);
    await expect(unwrapGiftWrap(mallory.signer, wrap)).rejects.toThrow();
    const dm = await unwrapGiftWrap(bob.signer, wrap);
    expect(dm.content).toBe("QUJDRA==".repeat(10));
  });
});

describe("unwrap verdicts vs transient failures", () => {
  it("every verdict core reaches itself is a GiftWrapRejectedError (never retry)", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "hi", bob.pubkey);

    // Wrong recipient: the NIP-44 MAC fails inside the codec. nostr-tools throws
    // a plain Error there, so core wraps a decrypt failure as a rejection too.
    const mallory = makeTestIdentity();
    await expect(unwrapGiftWrap(mallory.signer, wrap)).rejects.toBeInstanceOf(GiftWrapRejectedError);

    // Expired wrap.
    const expired = { ...wrap, tags: [...wrap.tags, ["expiration", "1"]] };
    await expect(unwrapGiftWrap(bob.signer, expired, { now: 2 })).rejects.toMatchObject({ name: "GiftWrapRejectedError", code: "expired" });

    // Unsupported rumor kind.
    const { wrap: odd } = await createGiftWrappedDM(ctxOf(alice), "x", bob.pubkey, undefined, await buildRumor(alice.pubkey, bob.pubkey, "x", undefined, { kind: 1 }));
    await expect(unwrapGiftWrap(bob.signer, odd)).rejects.toMatchObject({ name: "GiftWrapRejectedError", code: "kind" });
  });

  it("an unknown codec failure (a vendor's wrong-key or truncated-payload message) is a verdict, not a retry", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "hi", bob.pubkey);
    for (const msg of ["Invalid data size", "Unknown version", "Padded data too short", "Non-zero padding bytes", "something the extension made up"]) {
      const codec = { nip44Decrypt: async () => { throw new Error(msg); } };
      await expect(unwrapGiftWrap(codec, wrap)).rejects.toMatchObject({ name: "GiftWrapRejectedError", code: "decrypt" });
    }
    expect(isTransientCodecFailure(new Error("Invalid MAC"))).toBe(false);
    for (const msg of ["Signing operation timed out", "NIP-46 request timed out", "No signer available for NIP-44 decryption", "Extension is locked", "user rejected the request", "Your remote signer doesn't support NIP-44 decryption"]) {
      expect(isTransientCodecFailure(new Error(msg))).toBe(true);
    }
  });

  it("a codec that cannot answer (signer away, bunker timeout) propagates as-is so the caller can retry", async () => {
    const alice = makeTestIdentity();
    const bob = makeTestIdentity();
    const { wrap } = await createGiftWrappedDM(ctxOf(alice), "hi", bob.pubkey);
    const away = { nip44Decrypt: async () => { throw new Error("NIP-46 request timed out"); } };
    const err = await unwrapGiftWrap(away, wrap).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GiftWrapRejectedError);
    expect(err.message).toMatch(/timed out/);
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

  describe("ttl: stamped when the seal and wrap are built", () => {
    afterEach(() => vi.useRealTimers());

    it("a signer that queues for 30 s does not eat the lifetime of the wrap", async () => {
      vi.useFakeTimers();
      const t0 = 1_800_000_000;
      vi.setSystemTime(t0 * 1000);
      const alice = makeTestIdentity();
      const bob = makeTestIdentity();
      // A bunker-like signer: encrypt takes 10 s, signing 20 s more.
      const slow = {
        ...alice.signer,
        nip44Encrypt: async (peer: string, text: string) => {
          vi.setSystemTime((t0 + 10) * 1000);
          return alice.signer.nip44Encrypt(peer, text);
        },
        signEvent: async (u: Parameters<typeof alice.signer.signEvent>[0]) => {
          vi.setSystemTime((t0 + 30) * 1000);
          return alice.signer.signEvent(u);
        },
      };
      const { wrap } = await createGiftWrappedDM(
        { myPubkey: alice.pubkey, signer: slow },
        "key",
        bob.pubkey,
        undefined,
        undefined,
        { ttl: 45, expiration: t0 + 1 },
      );
      // The wrap is stamped after the seal was signed (t0 + 30); `ttl` wins over `expiration`.
      expect(wrap.tags).toContainEqual(["expiration", String(t0 + 30 + 45)]);
      // The seal is stamped after the encrypt (t0 + 10), before the signing
      // wait, with SEAL_TTL_SLACK_SEC more so that wait can never expire it first.
      const sealJson = await bob.signer.nip44Decrypt(wrap.pubkey, wrap.content);
      expect(JSON.parse(sealJson).tags).toContainEqual(["expiration", String(t0 + 10 + 45 + SEAL_TTL_SLACK_SEC)]);
      // A receiver with no skew allowance accepts it until the WRAP expires.
      const dm = await unwrapGiftWrap(bob.signer, wrap, { now: t0 + 30 + 44 });
      expect(dm.expiration).toBe(t0 + 30 + 45);
      await expect(unwrapGiftWrap(bob.signer, wrap, { now: t0 + 30 + 45 })).rejects.toThrow(/expired/);
    });
  });
});
