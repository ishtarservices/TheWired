import type { NostrEvent } from "@thewired/shared-types";

import { parseThreadRef, reactionTargetId, repostTargetId } from "../noteTags";

function withTags(tags: string[][]): NostrEvent {
  return { id: "x", pubkey: "p", created_at: 1, kind: 1, tags, content: "", sig: "s" };
}

describe("parseThreadRef", () => {
  it("prefers marked root/reply tags", () => {
    const ref = parseThreadRef(
      withTags([
        ["e", "root-id", "", "root"],
        ["e", "reply-id", "", "reply"],
        ["p", "author"],
      ]),
    );
    expect(ref).toEqual({ rootId: "root-id", replyId: "reply-id" });
  });

  it("root-only marked tag doubles as replyId", () => {
    const ref = parseThreadRef(withTags([["e", "root-id", "", "root"]]));
    expect(ref).toEqual({ rootId: "root-id", replyId: "root-id" });
  });

  it("positional: single e-tag is both root and reply", () => {
    const ref = parseThreadRef(withTags([["e", "only"]]));
    expect(ref).toEqual({ rootId: "only", replyId: "only" });
  });

  it("a lone mention-marked e-tag is not a reply (quote post)", () => {
    const ref = parseThreadRef(withTags([["e", "quoted", "", "mention"]]));
    expect(ref).toEqual({ rootId: null, replyId: null });
  });

  it("positional: first is root, last is reply, mentions filtered", () => {
    const ref = parseThreadRef(
      withTags([
        ["e", "root"],
        ["e", "mentioned", "", "mention"],
        ["e", "parent"],
      ]),
    );
    expect(ref).toEqual({ rootId: "root", replyId: "parent" });
  });

  it("no e-tags → not a reply", () => {
    expect(parseThreadRef(withTags([["p", "someone"]]))).toEqual({
      rootId: null,
      replyId: null,
    });
  });
});

describe("reaction/repost targets", () => {
  it("reaction target is the LAST e tag", () => {
    const event = withTags([
      ["e", "old"],
      ["p", "author"],
      ["e", "target"],
    ]);
    expect(reactionTargetId(event)).toBe("target");
  });

  it("repost target is the FIRST e tag", () => {
    const event = withTags([
      ["e", "target"],
      ["e", "other"],
    ]);
    expect(repostTargetId(event)).toBe("target");
  });

  it("both undefined without e tags", () => {
    expect(reactionTargetId(withTags([]))).toBeUndefined();
    expect(repostTargetId(withTags([]))).toBeUndefined();
  });
});
