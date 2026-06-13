import { describe, it, expect } from "vitest";
import { computeAnchoredPosition } from "../AnchoredPopover";

// Viewport 1000x800, default gap 6 / margin 8 unless overridden.
const viewport = { width: 1000, height: 800 };

function anchor(top: number, left = 100, width = 40, height = 30) {
  return { top, bottom: top + height, left, right: left + width };
}

describe("computeAnchoredPosition", () => {
  it("places below the anchor when there is room (the Feed-composer case)", () => {
    // Anchor near the top of the viewport, popup 400px tall → tons of room below.
    const a = anchor(50);
    const pos = computeAnchoredPosition(a, { width: 360, height: 400 }, viewport);
    expect(pos.placedBelow).toBe(true);
    expect(pos.top).toBe(a.bottom + 6);
    expect(pos.bottom).toBeNull();
    expect(pos.left).toBe(a.left);
    // maxHeight is the room below, so the panel can scroll within it.
    expect(pos.maxHeight).toBe(viewport.height - a.bottom - 6 - 8);
  });

  it("flips above when below doesn't fit but above does (chat-style bottom anchor)", () => {
    const a = anchor(700); // 70px of room below, 700px above
    const pos = computeAnchoredPosition(a, { width: 360, height: 400 }, viewport);
    expect(pos.placedBelow).toBe(false);
    expect(pos.top).toBeNull();
    // Anchored by distance-from-bottom so it grows upward from the anchor.
    expect(pos.bottom).toBe(viewport.height - a.top + 6);
    expect(pos.maxHeight).toBe(a.top - 6 - 8);
  });

  it("honors preferredSide 'above' when it has the room", () => {
    const a = anchor(500);
    const pos = computeAnchoredPosition(
      a,
      { width: 360, height: 400 },
      viewport,
      { preferredSide: "above" },
    );
    expect(pos.placedBelow).toBe(false);
  });

  it("flips a preferredSide 'above' popup below when above is too cramped", () => {
    const a = anchor(50); // almost no room above, lots below
    const pos = computeAnchoredPosition(
      a,
      { width: 360, height: 400 },
      viewport,
      { preferredSide: "above" },
    );
    expect(pos.placedBelow).toBe(true);
  });

  it("caps maxHeight to the available space when the panel fits nowhere (the bug)", () => {
    // 435px-tall emoji picker, anchor mid-screen: ~365px below, ~285px above.
    const a = anchor(300); // bottom=330
    const pos = computeAnchoredPosition(a, { width: 352, height: 435 }, viewport);
    // Neither side fits 435 → takes the roomier side (below) and caps to it.
    expect(pos.placedBelow).toBe(true);
    expect(pos.maxHeight).toBe(viewport.height - 330 - 6 - 8); // 456
    expect(pos.maxHeight).toBeLessThan(435 + 100); // never the full panel when cramped
  });

  it("never lets maxHeight go negative when the anchor is offscreen-low", () => {
    const a = anchor(900); // below the viewport bottom
    const pos = computeAnchoredPosition(a, { width: 360, height: 400 }, viewport);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it("clamps the left edge so a wide popup never overflows the right side", () => {
    const a = anchor(50, 900); // anchor near the right edge
    const pos = computeAnchoredPosition(a, { width: 360, height: 200 }, viewport);
    expect(pos.left).toBe(1000 - 360 - 8);
  });

  it("clamps the left edge to the margin on the left side", () => {
    const a = anchor(50, 2); // anchor hugging the left edge
    const pos = computeAnchoredPosition(a, { width: 360, height: 200 }, viewport);
    expect(pos.left).toBe(8);
  });

  it("caps maxWidth to the viewport so a wide panel can shrink", () => {
    const narrow = { width: 320, height: 800 };
    const a = anchor(50, 10);
    const pos = computeAnchoredPosition(a, { width: 460, height: 300 }, narrow);
    expect(pos.maxWidth).toBe(320 - 2 * 8);
    expect(pos.left).toBe(8); // clamped to the left margin
  });
});
