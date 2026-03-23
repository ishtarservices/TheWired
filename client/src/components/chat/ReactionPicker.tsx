import { useState, useCallback, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { buildReaction } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import type { CustomEmoji } from "@/types/emoji";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

interface ReactionPickerProps {
  targetEventId: string;
  targetPubkey: string;
  targetKind: number;
  onClose: () => void;
}

export function ReactionPicker({
  targetEventId,
  targetPubkey,
  targetKind,
  onClose,
}: ReactionPickerProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const shortcodeIndex = useAppSelector((s) => s.emoji.shortcodeIndex);
  const [showCustom, setShowCustom] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const react = useCallback(
    async (content: string, emojiTag?: string[]) => {
      if (!pubkey) return;
      const unsigned = buildReaction(
        pubkey,
        { eventId: targetEventId, pubkey: targetPubkey, kind: targetKind },
        content,
        emojiTag,
      );
      await signAndPublish(unsigned);
      onClose();
    },
    [pubkey, targetEventId, targetPubkey, targetKind, onClose],
  );

  const handleUnicodeReaction = useCallback(
    (emoji: string) => {
      react(emoji);
    },
    [react],
  );

  const handleCustomReaction = useCallback(
    (emoji: CustomEmoji) => {
      react(`:${emoji.shortcode}:`, ["emoji", emoji.shortcode, emoji.url]);
    },
    [react],
  );

  const customEmojis = Object.values(shortcodeIndex).slice(0, 16);

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full right-0 mb-1 z-50 rounded-lg border border-edge bg-panel shadow-lg p-1.5"
    >
      {/* Quick reactions row */}
      <div className="flex gap-0.5">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => handleUnicodeReaction(emoji)}
            className="rounded-md p-1.5 text-base hover:bg-surface-hover transition-colors"
            title={emoji}
          >
            {emoji}
          </button>
        ))}
        {customEmojis.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCustom((prev) => !prev)}
            className={`rounded-md p-1.5 transition-colors ${
              showCustom ? "bg-pulse/15 text-pulse" : "text-muted hover:bg-surface-hover hover:text-heading"
            }`}
            title="More reactions"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {/* Custom emojis */}
      {showCustom && customEmojis.length > 0 && (
        <div className="mt-1 pt-1 border-t border-edge">
          <div className="grid grid-cols-8 gap-0.5">
            {customEmojis.map((emoji) => (
              <button
                key={emoji.shortcode}
                type="button"
                onClick={() => handleCustomReaction(emoji)}
                className="rounded-md p-1 hover:bg-surface-hover transition-colors"
                title={`:${emoji.shortcode}:`}
              >
                <img
                  src={emoji.url}
                  alt={`:${emoji.shortcode}:`}
                  className="h-5 w-5 object-contain"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
