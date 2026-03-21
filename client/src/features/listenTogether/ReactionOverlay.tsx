import { useEffect, useState } from "react";
import type { ListenTogetherReaction } from "@/store/slices/listenTogetherSlice";

interface ReactionOverlayProps {
  reactions: ListenTogetherReaction[];
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number; // percentage from left
  startY: number;
}

/**
 * Floating emoji bubbles that animate upward and fade out
 * when participants react to the current track.
 */
export function ReactionOverlay({ reactions }: ReactionOverlayProps) {
  const [floaters, setFloaters] = useState<FloatingEmoji[]>([]);

  // Spawn new floaters when reactions change
  useEffect(() => {
    if (reactions.length === 0) return;

    const latest = reactions[reactions.length - 1];
    const id = `${latest.pubkey}-${latest.ts}-${Math.random()}`;
    const x = 10 + Math.random() * 80; // 10-90% from left

    setFloaters((prev) => [...prev, { id, emoji: latest.emoji, x, startY: 100 }]);

    // Remove after animation completes
    const timer = setTimeout(() => {
      setFloaters((prev) => prev.filter((f) => f.id !== id));
    }, 2000);

    return () => clearTimeout(timer);
  }, [reactions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (floaters.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
      {floaters.map((f) => (
        <span
          key={f.id}
          className="absolute text-xl animate-float-up"
          style={{
            left: `${f.x}%`,
            bottom: 0,
          }}
        >
          {f.emoji}
        </span>
      ))}

      {/* Animation keyframes injected via style tag */}
      <style>{`
        @keyframes float-up {
          0% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translateY(-150px) scale(1.2);
            opacity: 0;
          }
        }
        .animate-float-up {
          animation: float-up 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
