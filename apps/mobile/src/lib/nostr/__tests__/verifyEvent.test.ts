import { finalizeEvent, generateSecretKey } from "nostr-tools";

import { verifyEventSync } from "../verifyEvent";

function signedNote(content = "hello wired") {
  return finalizeEvent(
    { kind: 1, created_at: 1_700_000_000, tags: [], content },
    generateSecretKey(),
  );
}

describe("verifyEventSync", () => {
  it("accepts a properly signed event", () => {
    expect(verifyEventSync(signedNote())).toBe(true);
  });

  it("rejects tampered content (id mismatch)", () => {
    const event = signedNote();
    expect(verifyEventSync({ ...event, content: "tampered" })).toBe(false);
  });

  it("rejects a swapped signature", () => {
    const a = signedNote("a");
    const b = signedNote("b");
    expect(verifyEventSync({ ...a, sig: b.sig })).toBe(false);
  });

  it("rejects a forged pubkey", () => {
    const a = signedNote();
    const other = signedNote();
    expect(verifyEventSync({ ...a, pubkey: other.pubkey })).toBe(false);
  });

  it("fails closed on malformed input instead of throwing", () => {
    expect(
      verifyEventSync({
        id: "zz",
        pubkey: "not-hex",
        created_at: 0,
        kind: 1,
        tags: [],
        content: "",
        sig: "nope",
      }),
    ).toBe(false);
  });
});
