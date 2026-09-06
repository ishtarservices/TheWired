/**
 * Focus ("spotlight") layout: one large stage tile plus a filmstrip of the
 * remaining tiles. The strip goes on the right in wide containers and along
 * the bottom in narrow/tall ones so the stage keeps a usable aspect ratio.
 */
import type { TileRect } from "./computeGridLayout";

export interface FocusLayoutInput {
  containerWidth: number;
  containerHeight: number;
  /** Number of tiles in the strip (everything except the stage). */
  stripCount: number;
  aspectRatio?: number;
  gap?: number;
}

export interface FocusLayout {
  orientation: "right" | "bottom" | "none";
  stage: TileRect;
  /** null when there is nothing to put in the strip */
  strip: TileRect | null;
  stripTileWidth: number;
  stripTileHeight: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeFocusLayout({
  containerWidth: W,
  containerHeight: H,
  stripCount,
  aspectRatio = 16 / 9,
  gap = 8,
}: FocusLayoutInput): FocusLayout {
  const full: TileRect = { x: 0, y: 0, width: Math.max(0, W), height: Math.max(0, H) };
  if (stripCount <= 0 || W <= 0 || H <= 0) {
    return { orientation: "none", stage: full, strip: null, stripTileWidth: 0, stripTileHeight: 0 };
  }

  if (W / H >= 1.4) {
    const stripW = clamp(Math.round(W * 0.2), 160, 260);
    const tileW = stripW;
    const tileH = Math.floor(tileW / aspectRatio);
    return {
      orientation: "right",
      stage: { x: 0, y: 0, width: W - stripW - gap, height: H },
      strip: { x: W - stripW, y: 0, width: stripW, height: H },
      stripTileWidth: tileW,
      stripTileHeight: tileH,
    };
  }

  const stripH = clamp(Math.round(H * 0.2), 90, 160);
  const tileH = stripH;
  const tileW = Math.floor(tileH * aspectRatio);
  return {
    orientation: "bottom",
    stage: { x: 0, y: 0, width: W, height: H - stripH - gap },
    strip: { x: 0, y: H - stripH, width: W, height: stripH },
    stripTileWidth: tileW,
    stripTileHeight: tileH,
  };
}
