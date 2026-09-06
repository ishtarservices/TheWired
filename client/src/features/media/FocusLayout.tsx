import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { computeFocusLayout } from "./layout/computeFocusLayout";
import type { MediaTileModel } from "./types";

interface FocusLayoutProps {
  tiles: MediaTileModel[];
  stageTileId: string;
  width: number;
  height: number;
  gap?: number;
  renderTile: (tile: MediaTileModel, opts: { compact: boolean; onStage: boolean }) => ReactNode;
}

/**
 * One large stage tile + a scrollable filmstrip of everyone else (right in
 * wide containers, bottom in tall ones). Strip order is the stable tile
 * order — it never re-sorts by who is talking.
 */
export function FocusLayout({ tiles, stageTileId, width, height, gap = 8, renderTile }: FocusLayoutProps) {
  const stageTile = tiles.find((t) => t.id === stageTileId);
  const strip = tiles.filter((t) => t.id !== stageTileId);

  const layout = useMemo(
    () =>
      computeFocusLayout({
        containerWidth: width,
        containerHeight: height,
        stripCount: strip.length,
        gap,
      }),
    [width, height, strip.length, gap],
  );

  if (!stageTile || width === 0 || height === 0) return null;

  const vertical = layout.orientation === "right";

  return (
    <>
      <div
        className="absolute left-0 top-0 transition-[width,height] duration-200 ease-out"
        style={{ width: layout.stage.width, height: layout.stage.height }}
      >
        {renderTile(stageTile, { compact: false, onStage: true })}
      </div>

      {layout.strip && (
        <div
          className={cn(
            "absolute flex gap-2 overflow-auto scrollbar-thin",
            vertical ? "flex-col" : "flex-row",
          )}
          style={{
            left: layout.strip.x,
            top: layout.strip.y,
            width: layout.strip.width,
            height: layout.strip.height,
          }}
        >
          {strip.map((tile) => (
            <div
              key={tile.id}
              className="shrink-0"
              style={{ width: layout.stripTileWidth, height: layout.stripTileHeight }}
            >
              {renderTile(tile, { compact: true, onStage: false })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
