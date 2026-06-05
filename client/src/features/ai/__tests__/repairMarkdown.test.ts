import { describe, it, expect } from "vitest";
import { repairMarkdown } from "../markdown/repairMarkdown";

describe("repairMarkdown", () => {
  it("closes a dangling bold run", () => {
    expect(repairMarkdown("Here is **bold")).toBe("Here is **bold**");
  });

  it("leaves balanced bold untouched", () => {
    expect(repairMarkdown("Here is **bold** text")).toBe("Here is **bold** text");
  });

  it("closes an unterminated inline code span on the last line", () => {
    expect(repairMarkdown("Call `foo")).toBe("Call `foo`");
  });

  it("closes an open fenced code block and stops there", () => {
    const out = repairMarkdown("```js\nconst x = 1");
    expect(out).toBe("```js\nconst x = 1\n```");
  });

  it("does not touch a closed fenced code block", () => {
    const src = "```js\nconst x = 1\n```";
    expect(repairMarkdown(src)).toBe(src);
  });

  it("does not add inline backticks inside an open fence", () => {
    // Odd fence → returns early after closing the fence, ignoring inner backticks.
    const out = repairMarkdown("```\na ` b");
    expect(out).toBe("```\na ` b\n```");
  });

  it("is a no-op for plain text", () => {
    expect(repairMarkdown("just a sentence.")).toBe("just a sentence.");
  });
});
