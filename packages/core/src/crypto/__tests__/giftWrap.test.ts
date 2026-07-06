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
    await expect(unwrapGiftWrap(badCodec, fakeWrap)).rejects.toThrow(/kind/);
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
    await expect(unwrapGiftWrap(codec, fakeWrap)).rejects.toThrow(/encrypted/);
  });
});
