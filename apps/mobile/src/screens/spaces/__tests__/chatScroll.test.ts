import { NEAR_BOTTOM_THRESHOLD_PX, isNearBottom } from "../chatScroll";

// Geometry helper: a 600pt viewport over 2000pt of content unless overridden.
// Bottom offset = contentHeight - viewportHeight = 1400.
const geom = (offsetY: number, content = 2000, viewport = 600) => ({
  contentOffset: { x: 0, y: offsetY },
  layoutMeasurement: { width: 400, height: viewport },
  contentSize: { width: 400, height: content },
});

describe("isNearBottom", () => {
  it("is true at the exact bottom", () => {
    expect(isNearBottom(geom(1400))).toBe(true);
  });

  it("is true anywhere within the threshold of the bottom", () => {
    expect(isNearBottom(geom(1400 - NEAR_BOTTOM_THRESHOLD_PX))).toBe(true); // boundary inclusive
    expect(isNearBottom(geom(1350))).toBe(true);
  });

  it("is false once scrolled past the threshold into history", () => {
    expect(isNearBottom(geom(1400 - NEAR_BOTTOM_THRESHOLD_PX - 1))).toBe(false);
    expect(isNearBottom(geom(0))).toBe(false);
  });

  it("treats content shorter than the viewport as near bottom", () => {
    expect(isNearBottom(geom(0, 300))).toBe(true); // nothing to scroll
  });

  it("honors a custom threshold", () => {
    expect(isNearBottom(geom(1200), 8)).toBe(false);
    expect(isNearBottom(geom(1392), 8)).toBe(true);
    expect(isNearBottom(geom(1391), 8)).toBe(false);
  });
});
