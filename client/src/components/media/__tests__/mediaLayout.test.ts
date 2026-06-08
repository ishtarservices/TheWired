import { describe, it, expect } from "vitest";
import {
  orientationFromDims,
  orientationFromDimString,
  aspectFromDimString,
  needsBackdrop,
  clampedCardAspect,
  galleryLayout,
  FEED_ASPECT_CLAMP,
} from "../mediaLayout";

describe("orientationFromDims", () => {
  it("classifies landscape / portrait / square", () => {
    expect(orientationFromDims(1920, 1080)).toBe("landscape");
    expect(orientationFromDims(1080, 1920)).toBe("portrait");
    expect(orientationFromDims(600, 600)).toBe("square");
  });

  it("returns unknown for degenerate dimensions", () => {
    expect(orientationFromDims(0, 100)).toBe("unknown");
    expect(orientationFromDims(100, 0)).toBe("unknown");
    expect(orientationFromDims(NaN, 100)).toBe("unknown");
  });
});

describe("orientationFromDimString / aspectFromDimString", () => {
  it("parses imeta WxH strings", () => {
    expect(orientationFromDimString("1080x1920")).toBe("portrait");
    expect(orientationFromDimString("1920x1080")).toBe("landscape");
    expect(orientationFromDimString("600x600")).toBe("square");
    expect(aspectFromDimString("1920x1080")).toBeCloseTo(16 / 9, 5);
  });

  it("returns unknown / null for missing or malformed input", () => {
    expect(orientationFromDimString(undefined)).toBe("unknown");
    expect(orientationFromDimString("not-a-dim")).toBe("unknown");
    expect(aspectFromDimString(undefined)).toBeNull();
    expect(aspectFromDimString("0x100")).toBeNull();
  });
});

describe("needsBackdrop", () => {
  it("is true only for portrait or panorama (the zero-cost guard)", () => {
    expect(needsBackdrop(9 / 16)).toBe(true); // tall portrait
    expect(needsBackdrop(3)).toBe(true); // panorama
    expect(needsBackdrop(16 / 9)).toBe(false); // standard landscape
    expect(needsBackdrop(4 / 3)).toBe(false); // normal landscape
    expect(needsBackdrop(FEED_ASPECT_CLAMP.min)).toBe(false); // boundary
  });

  it("is false for invalid aspect", () => {
    expect(needsBackdrop(0)).toBe(false);
    expect(needsBackdrop(NaN)).toBe(false);
  });
});

describe("clampedCardAspect", () => {
  it("clamps tall/wide media into the feed range, passes normal through", () => {
    expect(clampedCardAspect(9 / 16)).toBeCloseTo(FEED_ASPECT_CLAMP.min, 5);
    expect(clampedCardAspect(21 / 9)).toBeCloseTo(FEED_ASPECT_CLAMP.max, 5);
    expect(clampedCardAspect(4 / 3)).toBeCloseTo(4 / 3, 5);
  });

  it("falls back to the max aspect for invalid input", () => {
    expect(clampedCardAspect(0)).toBeCloseTo(FEED_ASPECT_CLAMP.max, 5);
  });
});

describe("galleryLayout", () => {
  it("returns single for 0 or 1 image", () => {
    expect(galleryLayout(0)).toEqual({ kind: "single" });
    expect(galleryLayout(1)).toEqual({ kind: "single" });
  });

  it("returns grids for 2-4 with no overflow", () => {
    expect(galleryLayout(2)).toEqual({ kind: "grid", tiles: 2, columns: 2, overflow: 0 });
    expect(galleryLayout(3)).toEqual({ kind: "grid", tiles: 3, columns: 2, overflow: 0 });
    expect(galleryLayout(4)).toEqual({ kind: "grid", tiles: 4, columns: 2, overflow: 0 });
  });

  it("caps at 4 tiles and reports overflow for 5+", () => {
    expect(galleryLayout(5)).toEqual({ kind: "grid", tiles: 4, columns: 2, overflow: 1 });
    expect(galleryLayout(7)).toEqual({ kind: "grid", tiles: 4, columns: 2, overflow: 3 });
  });
});
