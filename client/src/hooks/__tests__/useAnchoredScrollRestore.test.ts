import { describe, it, expect, beforeEach } from "vitest";
import {
  captureScrollPosition,
  resolveScrollTop,
} from "../useAnchoredScrollRestore";

const ATTR = "data-feed-anchor";

/**
 * jsdom doesn't lay out, so we stub geometry. Each card lives at a fixed
 * *content* top; getBoundingClientRect returns viewport coords
 * (contentTop - scrollTop), exactly like a real scroll container.
 */
function makeContainer(): HTMLDivElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "getBoundingClientRect", {
    value: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    configurable: true,
  });
  // jsdom scrollTop is a plain settable number — good enough.
  container.scrollTop = 0;
  document.body.appendChild(container);
  return container;
}

function addCard(container: HTMLElement, id: string, contentTop: number, height = 100) {
  const el = document.createElement("div");
  el.setAttribute(ATTR, id);
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      top: contentTop - container.scrollTop,
      left: 0,
      right: 0,
      bottom: contentTop - container.scrollTop + height,
      width: 0,
      height,
    }),
    configurable: true,
  });
  container.appendChild(el);
  return el;
}

describe("captureScrollPosition", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("anchors to the card the viewport top is sitting on, with the px offset", () => {
    const c = makeContainer();
    addCard(c, "a", 0);
    addCard(c, "b", 100);
    addCard(c, "c", 200);
    addCard(c, "d", 300);
    c.scrollTop = 250; // viewport top is 50px into card "c"

    expect(captureScrollPosition(c, ATTR)).toEqual({
      scrollTop: 250,
      anchorId: "c",
      anchorOffset: 50,
    });
  });

  it("falls back to pixel-only when the viewport is above the first card (header)", () => {
    const c = makeContainer();
    // Cards start 500px down (below a profile header).
    addCard(c, "a", 500);
    addCard(c, "b", 600);
    c.scrollTop = 100;

    expect(captureScrollPosition(c, ATTR)).toEqual({ scrollTop: 100 });
  });

  it("returns scrollTop only when no card attribute is given", () => {
    const c = makeContainer();
    addCard(c, "a", 0);
    c.scrollTop = 42;
    expect(captureScrollPosition(c)).toEqual({ scrollTop: 42 });
  });

  it("picks the last card at/above the fold top, not a card below it", () => {
    const c = makeContainer();
    addCard(c, "a", 0);
    addCard(c, "b", 100);
    addCard(c, "c", 200);
    c.scrollTop = 100; // exactly the top of "b"
    const pos = captureScrollPosition(c, ATTR);
    expect(pos.anchorId).toBe("b");
    expect(pos.anchorOffset).toBe(0);
  });
});

describe("resolveScrollTop", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the scrollTop that puts the anchor card back at the same offset", () => {
    const c = makeContainer();
    addCard(c, "a", 0);
    addCard(c, "b", 100);
    addCard(c, "c", 200);

    const target = resolveScrollTop(
      c,
      { scrollTop: 250, anchorId: "c", anchorOffset: 50 },
      ATTR,
    );
    expect(target).toBe(250); // card "c" at content-top 200 + 50 offset
  });

  it("tracks the anchor when content above it grew (immune to height shift)", () => {
    const c = makeContainer();
    addCard(c, "a", 0);
    addCard(c, "b", 100);
    // Card "c" was at 200 when saved; an image above loaded and pushed it to 600.
    addCard(c, "c", 600);

    const target = resolveScrollTop(
      c,
      { scrollTop: 250, anchorId: "c", anchorOffset: 50 },
      ATTR,
    );
    expect(target).toBe(650); // re-pins to the card's *current* position
  });

  it("falls back to the saved pixel offset when the anchor card is gone", () => {
    const c = makeContainer();
    addCard(c, "a", 0);

    const target = resolveScrollTop(
      c,
      { scrollTop: 250, anchorId: "missing", anchorOffset: 50 },
      ATTR,
    );
    expect(target).toBe(250);
  });

  it("uses the pixel offset when there is no anchor id", () => {
    const c = makeContainer();
    expect(resolveScrollTop(c, { scrollTop: 123 }, ATTR)).toBe(123);
  });
});
