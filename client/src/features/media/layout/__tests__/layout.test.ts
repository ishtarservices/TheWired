/**
 * Layout engine invariants.
 *
 * pre-fix: `VideoGrid` used Tailwind column counts + `aspect-video` tiles in
 * an overflow-hidden container — rows overflowed and got clipped, and tiles
 * re-ordered on every active-speaker change.
 * post-fix asserts: the grid ALWAYS fits (property test over 1..49 tiles ×
 * several container sizes), sizing picks the largest tiles, focus priority
 * is pinned › focused › screenshare › held speaker, and the speaker hold
 * never flaps faster than its hold window.
 */
import { describe, it, expect } from "vitest";
import { computeGridLayout, positionGridTiles } from "../computeGridLayout";
import { computeFocusLayout } from "../computeFocusLayout";
import { resolveFocusTarget, nextSpeakerHold } from "../resolveFocusTarget";
import { nearestCorner } from "../nearestCorner";

describe("computeGridLayout", () => {
  it("single tile fills the container", () => {
    expect(
      computeGridLayout({ containerWidth: 1600, containerHeight: 900, count: 1, gap: 0 }),
    ).toEqual({ cols: 1, rows: 1, tileWidth: 1600, tileHeight: 900 });
  });

  it("two tiles side by side beat stacking in a wide container", () => {
    const l = computeGridLayout({ containerWidth: 1600, containerHeight: 900, count: 2, gap: 8 });
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(1);
    expect(l.tileWidth).toBe(796);
    expect(l.tileHeight).toBe(447);
  });

  it("four tiles in a square container → 2×2, width-limited", () => {
    const l = computeGridLayout({ containerWidth: 1000, containerHeight: 1000, count: 4, gap: 0 });
    expect(l).toEqual({ cols: 2, rows: 2, tileWidth: 500, tileHeight: 281 });
  });

  it("tall container stacks tiles in one column", () => {
    const l = computeGridLayout({ containerWidth: 400, containerHeight: 1200, count: 3, gap: 0 });
    expect(l).toEqual({ cols: 1, rows: 3, tileWidth: 400, tileHeight: 225 });
  });

  it("never overflows for 1..49 tiles across container shapes", () => {
    const sizes = [
      [320, 200],
      [1280, 720],
      [1920, 1080],
      [900, 1400],
      [640, 640],
    ];
    const gap = 8;
    for (const [W, H] of sizes) {
      for (let count = 1; count <= 49; count++) {
        const l = computeGridLayout({ containerWidth: W, containerHeight: H, count, gap });
        expect(l.cols * l.rows).toBeGreaterThanOrEqual(count);
        expect(l.cols * l.tileWidth + gap * (l.cols - 1)).toBeLessThanOrEqual(W);
        expect(l.rows * l.tileHeight + gap * (l.rows - 1)).toBeLessThanOrEqual(H);
        expect(l.tileWidth).toBeGreaterThan(0);
        // integer rounding dominates for tiny tiles — allow ±2px of height
        expect(Math.abs(l.tileWidth / l.tileHeight - 16 / 9)).toBeLessThan(Math.max(0.05, 2 / l.tileHeight));
        const rects = positionGridTiles(l, count, W, H, gap);
        expect(rects).toHaveLength(count);
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(W + 1);
          expect(r.y + r.height).toBeLessThanOrEqual(H + 1);
        }
      }
    }
  });

  it("returns zeros for empty / degenerate input", () => {
    expect(computeGridLayout({ containerWidth: 800, containerHeight: 600, count: 0 })).toEqual({
      cols: 0,
      rows: 0,
      tileWidth: 0,
      tileHeight: 0,
    });
    expect(computeGridLayout({ containerWidth: 0, containerHeight: 600, count: 3 }).tileWidth).toBe(0);
  });

  it("centers a partial last row", () => {
    const l = computeGridLayout({ containerWidth: 1000, containerHeight: 600, count: 3, gap: 0 });
    const rects = positionGridTiles(l, 3, 1000, 600, 0);
    // 2 columns, 2 rows → the lone third tile sits centered under the pair
    expect(l.cols).toBe(2);
    const third = rects[2];
    expect(third.x).toBe(Math.round((1000 - l.tileWidth) / 2));
  });
});

describe("computeFocusLayout", () => {
  it("puts the strip on the right in wide containers and fits", () => {
    const f = computeFocusLayout({ containerWidth: 1600, containerHeight: 900, stripCount: 3 });
    expect(f.orientation).toBe("right");
    expect(f.stage.width + 8 + f.strip!.width).toBe(1600);
    expect(f.stripTileWidth).toBe(f.strip!.width);
  });

  it("puts the strip at the bottom in tall containers", () => {
    const f = computeFocusLayout({ containerWidth: 800, containerHeight: 900, stripCount: 2 });
    expect(f.orientation).toBe("bottom");
    expect(f.stage.height + 8 + f.strip!.height).toBe(900);
  });

  it("gives the stage everything when the strip is empty", () => {
    const f = computeFocusLayout({ containerWidth: 800, containerHeight: 600, stripCount: 0 });
    expect(f.orientation).toBe("none");
    expect(f.strip).toBeNull();
    expect(f.stage).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

describe("resolveFocusTarget", () => {
  const base = {
    tileIds: ["a:camera", "b:camera", "b:screenshare"],
    screenShareTileIds: ["b:screenshare"],
    pinnedTileId: null,
    focusedTileId: null,
    autoFocusSpeaker: false,
    speakerTileId: null,
  };

  it("pinned beats everything", () => {
    expect(
      resolveFocusTarget({ ...base, pinnedTileId: "a:camera", focusedTileId: "b:camera", speakerTileId: "b:camera", autoFocusSpeaker: true }),
    ).toBe("a:camera");
  });

  it("focused beats the screen share", () => {
    expect(resolveFocusTarget({ ...base, focusedTileId: "a:camera" })).toBe("a:camera");
  });

  it("a screen share beats the active speaker", () => {
    expect(resolveFocusTarget({ ...base, autoFocusSpeaker: true, speakerTileId: "a:camera" })).toBe(
      "b:screenshare",
    );
  });

  it("falls through to the held speaker only when auto-focus is on", () => {
    const noShare = { ...base, tileIds: ["a:camera", "b:camera"], screenShareTileIds: [] };
    expect(resolveFocusTarget({ ...noShare, speakerTileId: "a:camera" })).toBeNull();
    expect(resolveFocusTarget({ ...noShare, speakerTileId: "a:camera", autoFocusSpeaker: true })).toBe(
      "a:camera",
    );
  });

  it("skips ids that left the room", () => {
    expect(resolveFocusTarget({ ...base, pinnedTileId: "gone:camera", focusedTileId: "gone:camera" })).toBe(
      "b:screenshare",
    );
  });
});

describe("nextSpeakerHold", () => {
  it("adopts the first speaker immediately", () => {
    expect(nextSpeakerHold({ current: null, since: 0 }, ["a"], 1000)).toEqual({ current: "a", since: 1000 });
  });

  it("keeps the current speaker while they are still speaking", () => {
    const s = { current: "a", since: 1000 };
    expect(nextSpeakerHold(s, ["b", "a"], 5000)).toBe(s);
  });

  it("does not switch faster than the hold window", () => {
    const s = { current: "a", since: 1000 };
    expect(nextSpeakerHold(s, ["b"], 2000)).toBe(s);
    expect(nextSpeakerHold(s, ["b"], 3001)).toEqual({ current: "b", since: 3001 });
  });

  it("keeps the last speaker during silence", () => {
    const s = { current: "a", since: 1000 };
    expect(nextSpeakerHold(s, [], 9000)).toBe(s);
  });
});

describe("nearestCorner", () => {
  it("maps quadrants to corners", () => {
    expect(nearestCorner(10, 10, 100, 100)).toBe("tl");
    expect(nearestCorner(90, 10, 100, 100)).toBe("tr");
    expect(nearestCorner(10, 90, 100, 100)).toBe("bl");
    expect(nearestCorner(90, 90, 100, 100)).toBe("br");
  });
});
