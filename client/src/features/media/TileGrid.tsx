import { useMemo, type ReactNode } from "react";
import { computeGridLayout, positionGridTiles } from "./layout/computeGridLayout";
import type { MediaTileModel } from "./types";

interface TileGridProps {
  tiles: MediaTileModel[];
  width: number;
  height: number;
  gap?: number;
  renderTile: (tile: MediaTileModel) => ReactNode;
}

/**
 * Equal-size grid. Tiles are absolutely positioned from the pure layout so
 * they animate between slots and can never overflow the container.
 */
export function TileGrid({ tiles, width, height, gap = 8, renderTile }: TileGridProps) {
  const rects = useMemo(() => {
    const layout = computeGridLayout({
      containerWidth: width,
      containerHeight: height,
      count: tiles.length,
      gap,
    });
    return positionGridTiles(layout, tiles.length, width, height, gap);
  }, [tiles.length, width, height, gap]);

  if (width === 0 || height === 0) return null;

  return (
    <>
      {tiles.map((tile, i) => {
        const r = rects[i];
        if (!r) return null;
        return (
          <div
            key={tile.id}
            className="absolute left-0 top-0 transition-[transform,width,height] duration-200 ease-out"
            style={{
              transform: `translate(${r.x}px, ${r.y}px)`,
              width: r.width,
              height: r.height,
            }}
          >
            {renderTile(tile)}
          </div>
        );
      })}
    </>
  );
}
