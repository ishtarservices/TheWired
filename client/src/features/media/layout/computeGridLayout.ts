/**
 * Pure grid sizing for N equal, fixed-aspect tiles inside a W×H container.
 *
 * Replaces the Tailwind `grid-cols-N` + `aspect-video` + `auto-rows-fr`
 * approach, which could not satisfy both the row count and the aspect ratio
 * at once: rows overflowed the (overflow-hidden) container and the bottom
 * tiles were clipped, while 1–2 participants in a wide window got tiny tiles.
 *
 * Google-Meet style: try every column count, size tiles to the tighter of
 * width/height, keep the layout with the largest tile area. Invariant: the
 * whole grid fits — `cols*tileWidth + gap*(cols-1) <= W` and
 * `rows*tileHeight + gap*(rows-1) <= H`.
 */

export interface GridLayoutInput {
  containerWidth: number;
  containerHeight: number;
  count: number;
  /** width / height, default 16:9 */
  aspectRatio?: number;
  gap?: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeGridLayout({
  containerWidth: W,
  containerHeight: H,
  count,
  aspectRatio = 16 / 9,
  gap = 8,
}: GridLayoutInput): GridLayout {
  if (count <= 0 || W <= 0 || H <= 0) {
    return { cols: 0, rows: 0, tileWidth: 0, tileHeight: 0 };
  }

  let best: GridLayout = { cols: 1, rows: count, tileWidth: 0, tileHeight: 0 };

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const availW = W - gap * (cols - 1);
    const availH = H - gap * (rows - 1);
    if (availW <= 0 || availH <= 0) continue;

    // Width-limited first, then shrink to the height if rows don't fit.
    let w = Math.floor(availW / cols);
    let h = Math.floor(w / aspectRatio);
    if (h * rows > availH) {
      h = Math.floor(availH / rows);
      w = Math.floor(h * aspectRatio);
    }
    if (w * h > best.tileWidth * best.tileHeight) {
      best = { cols, rows, tileWidth: w, tileHeight: h };
    }
  }

  return best;
}

/**
 * Absolute rects for each tile index, with the whole grid centered in the
 * container and a partial last row centered too.
 */
export function positionGridTiles(
  layout: GridLayout,
  count: number,
  containerWidth: number,
  containerHeight: number,
  gap = 8,
): TileRect[] {
  const { cols, rows, tileWidth, tileHeight } = layout;
  if (count <= 0 || cols === 0) return [];

  const gridW = cols * tileWidth + (cols - 1) * gap;
  const gridH = rows * tileHeight + (rows - 1) * gap;
  const offsetX = Math.max(0, (containerWidth - gridW) / 2);
  const offsetY = Math.max(0, (containerHeight - gridH) / 2);

  const rects: TileRect[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inLastRow = row === rows - 1;
    const lastRowCount = count - (rows - 1) * cols;
    const rowW = inLastRow ? lastRowCount * tileWidth + (lastRowCount - 1) * gap : gridW;
    const rowOffset = (gridW - rowW) / 2;
    rects.push({
      x: Math.round(offsetX + rowOffset + col * (tileWidth + gap)),
      y: Math.round(offsetY + row * (tileHeight + gap)),
      width: tileWidth,
      height: tileHeight,
    });
  }
  return rects;
}
