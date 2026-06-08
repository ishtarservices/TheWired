import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ArticleMarkdown } from "../ArticleMarkdown";

/**
 * Article bodies are attacker-controlled. These tests pin the safe-rendering
 * contract from the `nostr-security` skill: NO raw HTML, NO javascript: URLs.
 * If someone adds `rehype-raw`/`allowDangerousHtml`, these fail loudly.
 */
describe("ArticleMarkdown — untrusted content safety", () => {
  it("renders normal markdown (headings, emphasis, lists)", () => {
    const { container } = render(
      <ArticleMarkdown content={"# Title\n\nhello **world**\n\n- a\n- b"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("world");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("does NOT render raw HTML — scripts/img-onerror stay as literal text", () => {
    const { container } = render(
      <ArticleMarkdown content={"<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    // The raw <img> is escaped by react-markdown, so no element is produced.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("alert(1)");
  });

  it("still renders a real markdown image", () => {
    const { container } = render(
      <ArticleMarkdown content={"![pic](https://cdn.example.com/i.png)"} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/i.png");
  });

  it("neutralizes javascript: links", () => {
    const { container } = render(
      <ArticleMarkdown content={"[click me](javascript:alert(1))"} />,
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    const href = a?.getAttribute("href") ?? "";
    expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
  });

  it("keeps a normal https link intact", () => {
    const { container } = render(
      <ArticleMarkdown content={"[ok](https://example.com)"} />,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  });
});
