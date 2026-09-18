import { describe, it, expect } from "vitest";
import { resolveDMReplyTarget, dmReactionPills } from "../dmUtils";
import type { DMMessage } from "@/store/slices/dmSlice";

const msg = (over: Partial<DMMessage>): DMMessage => ({
  id: "x",
  senderPubkey: "a".repeat(64),
  content: "hi",
  createdAt: 1,
  wrapId: "wrap-x",
  ...over,
});

describe("resolveDMReplyTarget", () => {
  const messages = [
    // Recipient-side copy: wrap id differs from the sender's, rumor id is shared.
    msg({ id: "1", wrapId: "recipient-wrap-1", rumorId: "rumor-1", content: "first" }),
    msg({ id: "2", wrapId: "legacy-wrap-2", rumorId: undefined, content: "legacy" }),
    // A message whose wrapId coincidentally equals another's rumorId must lose
    // to the rumorId match.
    msg({ id: "3", wrapId: "rumor-1", rumorId: "rumor-3", content: "decoy" }),
  ];

  it("prefers the rumorId match (the id both parties share)", () => {
    expect(resolveDMReplyTarget(messages, "rumor-1")?.content).toBe("first");
  });

  it("falls back to wrapId for anchors written by older clients", () => {
    expect(resolveDMReplyTarget(messages, "legacy-wrap-2")?.content).toBe("legacy");
  });

  it("returns undefined for unknown anchors, empty input or no anchor", () => {
    expect(resolveDMReplyTarget(messages, "nope")).toBeUndefined();
    expect(resolveDMReplyTarget([], "rumor-1")).toBeUndefined();
    expect(resolveDMReplyTarget(undefined, "rumor-1")).toBeUndefined();
    expect(resolveDMReplyTarget(messages, undefined)).toBeUndefined();
  });
});

describe("dmReactionPills", () => {
  it("turns emoji → reactors into pills and flags mine", () => {
    const me = "a".repeat(64);
    const them = "b".repeat(64);
    expect(dmReactionPills({ "🔥": [me, them], "❤️": [them], "👻": [] }, me)).toEqual([
      { content: "🔥", count: 2, mine: true },
      { content: "❤️", count: 1, mine: false },
    ]);
    expect(dmReactionPills(undefined, me)).toEqual([]);
    expect(dmReactionPills({ "🔥": [me] }, null)).toEqual([{ content: "🔥", count: 1, mine: false }]);
  });
});
