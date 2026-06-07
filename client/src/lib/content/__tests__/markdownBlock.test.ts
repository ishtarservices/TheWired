import { describe, it, expect } from "vitest";
import {
  toggleHeading,
  toggleBulletList,
  toggleNumberList,
  toggleQuote,
  insertLink,
  insertImage,
} from "../markdownBlock";

describe("toggleHeading", () => {
  it("adds a heading on a caret-only line", () => {
    const r = toggleHeading("Hello", 0, 0, 2);
    expect(r.newValue).toBe("## Hello");
    expect(r.newCursorStart).toBe(0);
    expect(r.newCursorEnd).toBe("## Hello".length);
  });

  it("is idempotent: toggling the same level off restores the original", () => {
    const on = toggleHeading("Hello", 0, 0, 2);
    const off = toggleHeading(on.newValue, on.newCursorStart, on.newCursorEnd, 2);
    expect(off.newValue).toBe("Hello");
  });

  it("normalizes a different existing level instead of stacking #", () => {
    const r = toggleHeading("# a\nb", 0, 5, 2);
    expect(r.newValue).toBe("## a\n## b");
  });

  it("leaves blank lines untouched in a multi-line selection", () => {
    const r = toggleHeading("a\n\nb", 0, 4, 1);
    expect(r.newValue).toBe("# a\n\n# b");
  });
});

describe("toggleBulletList", () => {
  it("bullets every line of a multi-line selection", () => {
    const r = toggleBulletList("a\nb\nc", 0, 5);
    expect(r.newValue).toBe("- a\n- b\n- c");
  });

  it("toggles bullets off when all lines are already bulleted", () => {
    const r = toggleBulletList("- a\n- b\n- c", 0, 11);
    expect(r.newValue).toBe("a\nb\nc");
  });

  it("converts an existing numbered list to bullets", () => {
    const r = toggleBulletList("1. a\n2. b", 0, 9);
    expect(r.newValue).toBe("- a\n- b");
  });
});

describe("toggleNumberList", () => {
  it("numbers and renumbers lines sequentially", () => {
    const r = toggleNumberList("a\nb\nc", 0, 5);
    expect(r.newValue).toBe("1. a\n2. b\n3. c");
  });

  it("toggles numbering off when all lines are numbered", () => {
    const r = toggleNumberList("1. a\n2. b\n3. c", 0, 14);
    expect(r.newValue).toBe("a\nb\nc");
  });

  it("renumbers correctly when a blank line is in the middle", () => {
    const r = toggleNumberList("a\n\nb", 0, 4);
    expect(r.newValue).toBe("1. a\n\n2. b");
  });
});

describe("toggleQuote", () => {
  it("quotes and unquotes (round trip)", () => {
    const on = toggleQuote("a\nb", 0, 3);
    expect(on.newValue).toBe("> a\n> b");
    const off = toggleQuote(on.newValue, 0, on.newValue.length);
    expect(off.newValue).toBe("a\nb");
  });
});

describe("operates only on the spanned lines (caret mid-document)", () => {
  it("only touches the line under the caret", () => {
    const value = "first\nsecond\nthird";
    // caret somewhere inside "second"
    const caret = value.indexOf("second") + 2;
    const r = toggleBulletList(value, caret, caret);
    expect(r.newValue).toBe("first\n- second\nthird");
  });
});

describe("insertLink", () => {
  it("wraps the selected text as the link label and highlights the label", () => {
    const value = "see foo";
    const r = insertLink(value, 4, 7, { url: "https://x.com" });
    expect(r.newValue).toBe("see [foo](https://x.com)");
    expect(r.newValue.slice(r.newCursorStart, r.newCursorEnd)).toBe("foo");
  });

  it("uses provided text when there is no selection", () => {
    const r = insertLink("", 0, 0, { url: "https://x.com", text: "Click" });
    expect(r.newValue).toBe("[Click](https://x.com)");
  });

  it("falls back to a label when neither selection nor text is given", () => {
    const r = insertLink("", 0, 0, { url: "https://x.com" });
    expect(r.newValue).toBe("[https://x.com](https://x.com)");
  });
});

describe("insertImage", () => {
  it("inserts an image at an empty caret", () => {
    const r = insertImage("", 0, 0, { url: "https://x/i.png", alt: "cat" });
    expect(r.newValue).toBe("![cat](https://x/i.png)");
    expect(r.newCursorStart).toBe(r.newValue.length);
  });

  it("puts the image on its own line when appended to existing text", () => {
    const value = "intro";
    const r = insertImage(value, value.length, value.length, { url: "u", alt: "" });
    expect(r.newValue).toBe("intro\n![](u)");
  });

  it("replaces a selection with the image and separates it onto its own line", () => {
    const value = "before after";
    const r = insertImage(value, 0, 6, { url: "u", alt: "pic" });
    // "before" is replaced; the trailing " after" gets pushed onto a new line.
    expect(r.newValue).toBe("![pic](u)\n after");
  });
});
