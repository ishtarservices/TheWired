import { describe, it, expect } from "vitest";
import { initialProfileTab } from "../profileSection";

describe("initialProfileTab", () => {
  it("a recognised ?section wins over the remembered tab", () => {
    expect(initialProfileTab("music", "reads")).toBe("music");
    expect(initialProfileTab("MUSIC", undefined)).toBe("music");
  });

  it("falls back to the remembered tab, then notes", () => {
    expect(initialProfileTab(undefined, "media")).toBe("media");
    expect(initialProfileTab("bogus", "media")).toBe("media");
    expect(initialProfileTab(null, undefined)).toBe("notes");
  });
});
