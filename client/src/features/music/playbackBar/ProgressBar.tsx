import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

interface ProgressBarProps {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

export function ProgressBar({ position, duration, onSeek }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const fraction = duration > 0 ? position / duration : 0;
  const displayFraction = isDragging && hoverFraction !== null ? hoverFraction : fraction;

  const getFraction = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (!duration) return;
      e.preventDefault();
      setIsDragging(true);
      const f = getFraction(e.clientX);
      setHoverFraction(f);
      onSeek(f * duration);

      const handleMouseMove = (ev: globalThis.MouseEvent) => {
        const mf = getFraction(ev.clientX);
        setHoverFraction(mf);
        onSeek(mf * duration);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        setHoverFraction(null);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [duration, getFraction, onSeek],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (!isDragging) {
        setHoverFraction(getFraction(e.clientX));
      }
    },
    [isDragging, getFraction],
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) setHoverFraction(null);
  }, [isDragging]);

  return (
    <div
      ref={barRef}
      className="group relative h-3 w-full cursor-pointer flex items-center"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Track */}
      <div className="relative h-[3px] w-full rounded-full bg-white/10 transition-[height] duration-150 group-hover:h-[5px]">
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pulse to-neon"
          style={{ width: `${displayFraction * 100}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-heading shadow-md opacity-0 transition-opacity group-hover:opacity-100"
          style={{ left: `calc(${displayFraction * 100}% - 6px)` }}
        />
      </div>
    </div>
  );
}
