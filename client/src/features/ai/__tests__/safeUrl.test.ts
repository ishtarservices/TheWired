import { describe, it, expect } from "vitest";
import { safeHref, safeImageSrc } from "../markdown/safeUrl";

describe("safeHref", () => {
  it("allows http(s) and mailto", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("rejects dangerous schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox")).toBeUndefined();
  });

  it("rejects relative / garbage urls and empty", () => {
    expect(safeHref("/relative/path")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("safeImageSrc", () => {
  it("allows only http(s)", () => {
    expect(safeImageSrc("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBeUndefined();
    expect(safeImageSrc("mailto:a@b.com")).toBeUndefined();
  });
});
