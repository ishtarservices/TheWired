import { describe, it, expect } from "vitest";
import { summarizeContent } from "../contentPreview";

describe("summarizeContent — friendly one-line previews", () => {
  it("replaces a bare nostr note reference with a label", () => {
    expect(summarizeContent("nostr:nevent1qqsxyz0123456789")).toBe("📝 note");
    expect(summarizeContent("note1abcdef0123456789")).toBe("📝 note");
    expect(summarizeContent("nostr:naddr1qqqsabc123")).toBe("📝 note");
  });

  it("keeps surrounding text and labels the reference inline", () => {
    expect(summarizeContent("check this out nostr:nevent1abc123")).toBe(
      "check this out 📝 note",
    );
  });

  it("labels media URLs by type", () => {
    expect(summarizeContent("https://cdn.example.com/a.jpg")).toBe("📷 photo");
    expect(summarizeContent("look https://x.com/clip.mp4 cool")).toBe("look 🎥 video cool");
    expect(summarizeContent("https://x.com/song.mp3")).toBe("🎵 audio");
  });

  it("labels profile mentions", () => {
    expect(summarizeContent("hey nostr:npub1abc123 there")).toBe("hey @mention there");
  });

  it("leaves plain text untouched (aside from whitespace collapse)", () => {
    expect(summarizeContent("just a normal message")).toBe("just a normal message");
    expect(summarizeContent("  spaced   out \n text ")).toBe("spaced out text");
  });

  it("does not mistake ordinary words for references", () => {
    expect(summarizeContent("take notes and note the time")).toBe(
      "take notes and note the time",
    );
  });
});
