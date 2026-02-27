import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizeHandleOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Which edge of the panel the handle sits on */
  side: "left" | "right";
}

export function useResizeHandle({
  defaultWidth = 256,
  minWidth = 180,
  maxWidth = 400,
  side,
}: UseResizeHandleOptions) {
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef({ startX: 0, startWidth: 0 });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startWidth: width };
      setIsDragging(true);
    },
    [width],
  );

  const onDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const { startX, startWidth } = drag.current;
      const delta = e.clientX - startX;
      const next =
        side === "right" ? startWidth + delta : startWidth - delta;
      setWidth(Math.max(minWidth, Math.min(maxWidth, next)));
    };

    const onMouseUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, minWidth, maxWidth, side]);

  return { width, isDragging, onMouseDown, onDoubleClick };
}
