import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { SmilePlus } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { useEmojiMartCustomCategories } from "@/hooks/useCustomEmojis";
import { buildReaction } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import type { CustomEmoji } from "@/types/emoji";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

/** Approximate heights for positioning before first paint */
const COMPACT_HEIGHT = 48;
const FULL_HEIGHT = 490;
const PICKER_WIDTH = 360;

interface ReactionPickerProps {
  targetEventId: string;
  targetPubkey: string;
  targetKind: number;
  /** Ref to the button that triggered this picker — used for positioning */
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

// Lazy-loaded emoji-mart modules (shared across instances)
let emojiData: unknown = null;
let PickerComponent: React.ComponentType<Record<string, unknown>> | null = null;

export function ReactionPicker({
  targetEventId,
  targetPubkey,
  targetKind,
  anchorRef,
  onClose,
}: ReactionPickerProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const shortcodeIndex = useAppSelector((s) => s.emoji.shortcodeIndex);
  const spaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const customCategories = useEmojiMartCustomCategories(spaceId);

  const [showFull, setShowFull] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(!!PickerComponent);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ opacity: 0 });

  // ── Positioning: fixed via portal, smart above/below ──

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const picker = pickerRef.current;
    const ph = picker?.offsetHeight ?? (showFull ? FULL_HEIGHT : COMPACT_HEIGHT);
    const pw = picker?.offsetWidth ?? PICKER_WIDTH;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const gap = 6;

    // Horizontal: right-align with anchor, clamp to viewport
    let left = rect.right - pw;
    if (left < 8) left = 8;
    if (left + pw > vw - 8) left = vw - pw - 8;

    // Vertical: prefer above the trigger, fall back to below
    let top: number;
    if (rect.top >= ph + gap) {
      // Enough space above
      top = rect.top - ph - gap;
    } else if (vh - rect.bottom >= ph + gap) {
      // Enough space below
      top = rect.bottom + gap;
    } else {
      // Not enough either way — anchor to whichever side has more room,
      // and constrain height via max-height on the picker
      if (rect.top > vh - rect.bottom) {
        top = Math.max(8, rect.top - ph - gap);
      } else {
        top = rect.bottom + gap;
      }
    }
    if (top < 8) top = 8;

    setPos({ top, left, opacity: 1 });
  }, [anchorRef, showFull]);

  // Position before paint (after render / size changes)
  useLayoutEffect(() => {
    reposition();
  }, [reposition, pickerLoaded]);

  // ── Close on click outside ──
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

  // ── Close on Escape ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Close on scroll OUTSIDE the picker (chat scroll, page scroll, etc.)
  //    but NOT when scrolling the emoji grid inside the picker ──
  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (pickerRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  // ── Lazy-load emoji-mart when full picker is requested ──
  useEffect(() => {
    if (!showFull || PickerComponent) return;

    let mounted = true;
    Promise.all([
      import("@emoji-mart/data"),
      import("@emoji-mart/react"),
    ]).then(([dataModule, pickerModule]) => {
      if (!mounted) return;
      emojiData = dataModule.default;
      PickerComponent = pickerModule.default;
      setPickerLoaded(true);
    });

    return () => { mounted = false; };
  }, [showFull]);

  // ── Reaction handlers ──

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
    (emoji: string) => react(emoji),
    [react],
  );

  const handleCustomReaction = useCallback(
    (emoji: CustomEmoji) =>
      react(`:${emoji.shortcode}:`, ["emoji", emoji.shortcode, emoji.url]),
    [react],
  );

  const handleFullPickerSelect = useCallback(
    (emoji: Record<string, unknown>) => {
      if (emoji.src) {
        react(
          `:${emoji.id as string}:`,
          ["emoji", emoji.id as string, emoji.src as string],
        );
      } else if (emoji.native) {
        react(emoji.native as string);
      }
    },
    [react],
  );

  const customEmojis = Object.values(shortcodeIndex).slice(0, 16);

  // ── Render via portal to escape scroll container clipping ──

  return createPortal(
    <div
      ref={pickerRef}
      className="fixed z-[9999] rounded-xl border border-border bg-panel shadow-2xl shadow-black/50"
      style={pos}
    >
      {/* Full emoji-mart picker */}
      {showFull && (
        <div className="rounded-t-xl overflow-hidden">
          {pickerLoaded && PickerComponent ? (
            <PickerComponent
              data={emojiData}
              onEmojiSelect={handleFullPickerSelect}
              theme="dark"
              set="native"
              custom={customCategories.length > 0 ? customCategories : undefined}
              autoFocus={true}
              perLine={9}
              emojiSize={28}
              emojiButtonSize={36}
              maxFrequentRows={2}
              previewPosition="none"
              skinTonePosition="search"
              navPosition="bottom"
            />
          ) : (
            <div
              className="flex items-center justify-center bg-panel"
              style={{ width: 360, height: 400 }}
            >
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
        </div>
      )}

      {/* Quick reactions bar */}
      <div className={`flex items-center gap-0.5 p-1.5 ${showFull ? "border-t border-border" : ""}`}>
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => handleUnicodeReaction(emoji)}
            className="rounded-md p-1.5 text-base hover:bg-surface-hover transition-colors hover:scale-110 active:scale-95"
            title={emoji}
          >
            {emoji}
          </button>
        ))}

        {!showFull && customEmojis.length > 0 && customEmojis.slice(0, 3).map((emoji) => (
          <button
            key={emoji.shortcode}
            type="button"
            onClick={() => handleCustomReaction(emoji)}
            className="rounded-md p-1 hover:bg-surface-hover transition-colors hover:scale-110 active:scale-95"
            title={`:${emoji.shortcode}:`}
          >
            <img
              src={emoji.url}
              alt={`:${emoji.shortcode}:`}
              className="h-5 w-5 object-contain"
            />
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowFull((prev) => !prev)}
          className={`rounded-md p-1.5 transition-colors ${
            showFull
              ? "bg-primary/15 text-primary"
              : "text-muted hover:bg-surface-hover hover:text-heading"
          }`}
          title={showFull ? "Hide emoji picker" : "Browse all emojis"}
        >
          <SmilePlus size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
