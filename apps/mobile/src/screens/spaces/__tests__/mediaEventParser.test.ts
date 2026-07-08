import { parseMediaEvent, parseMediaEvents } from "../mediaEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const event = (kind: number, tags: string[][]): NostrEvent => ({
  id: `id-${kind}-${tags.length}`,
  pubkey: "p".repeat(64),
  created_at: 1,
  kind,
  tags,
  content: "",
  sig: "",
});

describe("parseMediaEvent", () => {
  it("parses a kind-20 picture from imeta", () => {
    const item = parseMediaEvent(
      event(20, [["imeta", "url https://cdn.x/a.jpg", "m image/jpeg", "dim 800x600"]]),
    );
    expect(item).toMatchObject({ type: "image", src: "https://cdn.x/a.jpg" });
  });

  it("parses a video with imeta poster", () => {
    const item = parseMediaEvent(
      event(21, [["imeta", "url https://cdn.x/v.mp4", "image https://cdn.x/poster.jpg"]]),
    );
    expect(item).toMatchObject({
      type: "video",
      src: "https://cdn.x/v.mp4",
      poster: "https://cdn.x/poster.jpg",
    });
  });

  it("falls back to url/thumb tags on addressable video kinds", () => {
    const item = parseMediaEvent(
      event(34235, [
        ["url", "https://cdn.x/v.mp4"],
        ["thumb", "https://cdn.x/t.jpg"],
      ]),
    );
    expect(item).toMatchObject({ type: "video", src: "https://cdn.x/v.mp4", poster: "https://cdn.x/t.jpg" });
  });

  it("rejects non-https and missing urls (fail closed)", () => {
    expect(parseMediaEvent(event(20, [["imeta", "url javascript:alert(1)"]]))).toBeNull();
    expect(parseMediaEvent(event(20, [["imeta", "url http://cdn.x/a.jpg"]]))).toBeNull();
    expect(parseMediaEvent(event(21, []))).toBeNull();
  });

  it("ignores non-media kinds", () => {
    expect(parseMediaEvent(event(1, [["imeta", "url https://cdn.x/a.jpg"]]))).toBeNull();
  });

  it("parseMediaEvents drops nulls", () => {
    const items = parseMediaEvents([
      event(20, [["imeta", "url https://cdn.x/a.jpg"]]),
      event(21, []),
    ]);
    expect(items).toHaveLength(1);
  });
});
