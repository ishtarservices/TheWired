import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AIMarkdown } from "../markdown/AIMarkdown";

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("AIMarkdown", () => {
  it("renders headings, emphasis, and lists", () => {
    const { container } = render(<AIMarkdown content={"# Title\n\nhello **world**\n\n- a\n- b"} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("world");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("incremental streaming yields the same final output as a one-shot parse", () => {
    const full = "# A\n\nparagraph one\n\n- item 1\n- item 2\n\nparagraph two with **bold**";
    const { container, rerender } = render(<AIMarkdown content="# A" streaming />);
    // Simulate streaming flushes growing the content (exercises the incremental
    // tail-relex fast path across many renders).
    for (let i = 4; i < full.length; i += 6) {
      rerender(<AIMarkdown content={full.slice(0, i)} streaming />);
    }
    rerender(<AIMarkdown content={full} streaming />);
    const streamed = norm(container.textContent);

    const { container: oneShot } = render(<AIMarkdown content={full} />);
    expect(streamed).toBe(norm(oneShot.textContent));
  });

  it("repairs an unterminated bold while streaming (no raw ** leaks)", () => {
    const { container } = render(<AIMarkdown content={"this is **bold"} streaming />);
    expect(container.querySelector("strong")?.textContent).toContain("bold");
  });

  describe("safe inline HTML allowlist (remarkInlineTags)", () => {
    it("renders <u> (Markdown has no underline syntax)", () => {
      const { container } = render(<AIMarkdown content={"a <u>underlined</u> word"} />);
      expect(container.querySelector("u")?.textContent).toBe("underlined");
    });

    it("renders <mark>, <sub>, <sup>, <br>, and maps <b>/<i>/<s>", () => {
      const { container } = render(
        <AIMarkdown content={"<mark>hi</mark> <sub>2</sub> <sup>3</sup> <b>bold</b> <i>it</i> <s>no</s><br>next"} />,
      );
      expect(container.querySelector("mark")?.textContent).toBe("hi");
      expect(container.querySelector("sub")?.textContent).toBe("2");
      expect(container.querySelector("sup")?.textContent).toBe("3");
      expect(container.querySelector("strong")?.textContent).toBe("bold");
      expect(container.querySelector("em")?.textContent).toBe("it");
      expect(container.querySelector("del")?.textContent).toBe("no");
      expect(container.querySelector("br")).not.toBeNull();
    });

    it("does NOT render disallowed tags — scripts/images stay literal text", () => {
      const { container } = render(
        <AIMarkdown content={"<script>alert(1)</script> and <img src=x onerror=alert(2)>"} />,
      );
      expect(container.querySelector("script")).toBeNull();
      // the <img> here is raw HTML (react-markdown escapes it); our img component
      // only fires for real Markdown images, so no element is produced from this.
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("alert(1)");
    });

    it("rejects allowlisted tags that carry attributes (no breakout)", () => {
      const { container } = render(
        <AIMarkdown content={'<u onclick="steal()">x</u> <u class="y">z</u>'} />,
      );
      // Neither matches the bare-tag pattern → no <u> elements, text stays literal.
      expect(container.querySelector("u")).toBeNull();
      expect(container.textContent).toContain("onclick");
    });
  });
});
