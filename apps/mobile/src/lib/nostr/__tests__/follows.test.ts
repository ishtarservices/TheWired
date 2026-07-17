import type { NostrEvent } from "@thewired/shared-types";

import { parseFollowList } from "../follows";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const PK_C = "c".repeat(64);

function kind3(created_at: number, tags: string[][]): NostrEvent {
  return { id: `k3-${created_at}`, pubkey: "me", created_at, kind: 3, tags, content: "", sig: "s" };
}

describe("parseFollowList", () => {
  it("returns null when no kind-3 is present", () => {
    const other: NostrEvent = { ...kind3(100, []), kind: 1 };
    expect(parseFollowList([other])).toBeNull();
    expect(parseFollowList([])).toBeNull();
  });

  it("parses p tags in order", () => {
    const parsed = parseFollowList([kind3(100, [["p", PK_A], ["p", PK_B]])]);
    expect(parsed).toEqual({ pubkeys: [PK_A, PK_B], listCreatedAt: 100 });
  });

  it("latest created_at wins across relay copies", () => {
    const parsed = parseFollowList([
      kind3(100, [["p", PK_A]]),
      kind3(300, [["p", PK_C]]),
      kind3(200, [["p", PK_B]]),
    ]);
    expect(parsed?.pubkeys).toEqual([PK_C]);
    expect(parsed?.listCreatedAt).toBe(300);
  });

  it("skips malformed p tags", () => {
    const parsed = parseFollowList([
      kind3(100, [
        ["p"], // missing value
        ["p", "not-hex"],
        ["p", PK_A.slice(0, 32)], // wrong length
        ["e", PK_B], // wrong tag name
        ["p", PK_A],
      ]),
    ]);
    expect(parsed?.pubkeys).toEqual([PK_A]);
  });

  it("lowercases uppercase hex", () => {
    const parsed = parseFollowList([kind3(100, [["p", PK_A.toUpperCase()]])]);
    expect(parsed?.pubkeys).toEqual([PK_A]);
  });

  it("dedupes preserving first occurrence", () => {
    const parsed = parseFollowList([
      kind3(100, [["p", PK_B], ["p", PK_A], ["p", PK_B]]),
    ]);
    expect(parsed?.pubkeys).toEqual([PK_B, PK_A]);
  });

  it("an existing-but-empty kind-3 is ready-empty, not missing", () => {
    const parsed = parseFollowList([kind3(100, [])]);
    expect(parsed).toEqual({ pubkeys: [], listCreatedAt: 100 });
  });
});
