import { collapseInlineSeams } from "../inlineSeams";

// Element stand-in — anything non-string breaks a merge run.
const EL = { el: true };

describe("collapseInlineSeams", () => {
  it("collapses the double gap a lifted mid-text ref leaves behind", () => {
    // "sharing this nostr:nevent1… by @loki" → text "sharing this " + " by "
    expect(collapseInlineSeams(["sharing this ", " by "])).toEqual(["sharing this by "]);
  });

  it("preserves an intentional newline boundary over a space", () => {
    expect(collapseInlineSeams(["check this\n", " more below"])).toEqual([
      "check this\nmore below",
    ]);
    expect(collapseInlineSeams(["check this ", "\nmore below"])).toEqual([
      "check this\nmore below",
    ]);
  });

  it("dissolves a pure-whitespace run stranded between two seams", () => {
    // "a nostr:x nostr:y b" → "a ", " ", " b"
    expect(collapseInlineSeams(["a ", " ", " b"])).toEqual(["a b"]);
  });

  it("keeps no-gap adjacency verbatim (hashtag runs)", () => {
    expect(collapseInlineSeams(["try", "#tag"])).toEqual(["try#tag"]);
    expect(collapseInlineSeams(["try ", "#tag", " ok"])).toEqual(["try #tag ok"]);
  });

  it("never merges across element nodes", () => {
    expect(collapseInlineSeams(["hey ", EL, " check"])).toEqual(["hey ", EL, " check"]);
  });

  it("passes through single/empty inputs untouched", () => {
    expect(collapseInlineSeams([])).toEqual([]);
    expect(collapseInlineSeams(["solo "])).toEqual(["solo "]);
    expect(collapseInlineSeams([EL])).toEqual([EL]);
  });
});
