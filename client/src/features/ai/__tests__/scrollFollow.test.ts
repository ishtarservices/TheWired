import { describe, it, expect } from "vitest";
import { isAtBottom, nextStick, BOTTOM_PX } from "../scrollFollow";

// scrollHeight 1000, clientHeight 400 → max scrollTop = 600 (that's the bottom).
const M = (top: number, lastTop: number) => ({
  top,
  lastTop,
  scrollHeight: 1000,
  clientHeight: 400,
});

describe("isAtBottom", () => {
  it("is true at/near the bottom, false above it", () => {
    expect(isAtBottom(M(600, 600))).toBe(true);
    expect(isAtBottom(M(600 - (BOTTOM_PX - 1), 600))).toBe(true); // within threshold
    expect(isAtBottom(M(600 - (BOTTOM_PX + 50), 600))).toBe(false);
    expect(isAtBottom(M(0, 600))).toBe(false);
  });
});

describe("nextStick", () => {
  it("releases the follow when the user scrolls up", () => {
    // was following (true), user moved up from 600 → 300
    expect(nextStick(true, M(300, 600))).toBe(false);
  });

  it("re-attaches when the user returns to the bottom", () => {
    // was released (false), user scrolled down to the bottom
    expect(nextStick(false, M(600, 300))).toBe(true);
  });

  it("stays released while scrolling down but not yet at the bottom", () => {
    expect(nextStick(false, M(300, 100))).toBe(false);
  });

  it("stays attached for tiny jitter at the bottom (no false release)", () => {
    // a 1px wobble at the bottom shouldn't drop the follow
    expect(nextStick(true, M(599, 600))).toBe(true);
  });

  it("keeps following when content grows under us (lastTop unchanged, still at bottom)", () => {
    expect(nextStick(true, M(600, 600))).toBe(true);
  });
});
