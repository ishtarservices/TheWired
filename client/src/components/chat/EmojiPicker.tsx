import { useEffect, useRef, useCallback, useState } from "react";
import { useEmojiMartCustomCategories } from "@/hooks/useCustomEmojis";

interface EmojiPickerProps {
  /** Current space ID for space-scoped custom emojis */
  spaceId?: string | null;
  onEmojiSelect: (emoji: EmojiSelectResult) => void;
  onClose: () => void;
}

export interface EmojiSelectResult {
  /** The native Unicode character (for standard emojis) */
  native?: string;
  /** Custom emoji shortcode (for NIP-30 emojis) */
  shortcode?: string;
  /** Custom emoji image URL */
  src?: string;
  /** Whether this is a custom emoji */
  isCustom: boolean;
}

// Lazy-loaded emoji-mart modules
let emojiData: unknown = null;
let PickerComponent: React.ComponentType<Record<string, unknown>> | null = null;

export function EmojiPicker({ spaceId, onEmojiSelect, onClose }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const customCategories = useEmojiMartCustomCategories(spaceId);
  const [loaded, setLoaded] = useState(!!PickerComponent);

  // Load emoji-mart lazily
  useEffect(() => {
    if (PickerComponent) return;

    let mounted = true;
    Promise.all([
      import("@emoji-mart/data"),
      import("@emoji-mart/react"),
    ]).then(([dataModule, pickerModule]) => {
      if (!mounted) return;
      emojiData = dataModule.default;
      PickerComponent = pickerModule.default;
      setLoaded(true);
    });

    return () => { mounted = false; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const handleSelect = useCallback(
    (emoji: Record<string, unknown>) => {
      if (emoji.src) {
        onEmojiSelect({
          shortcode: (emoji.id as string) || "",
          src: emoji.src as string,
          isCustom: true,
        });
      } else {
        onEmojiSelect({
          native: emoji.native as string,
          isCustom: false,
        });
      }
    },
    [onEmojiSelect],
  );

  if (!loaded || !PickerComponent) {
    return (
      <div
        ref={pickerRef}
        className="absolute bottom-full left-0 mb-2 z-50 rounded-xl overflow-hidden shadow-xl border border-edge bg-panel flex items-center justify-center"
        style={{ width: 352, height: 435 }}
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
      </div>
    );
  }

  const Picker = PickerComponent;

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full left-0 mb-2 z-50 rounded-xl overflow-hidden shadow-xl border border-edge"
    >
      <Picker
        data={emojiData}
        onEmojiSelect={handleSelect}
        theme="dark"
        set="native"
        custom={customCategories.length > 0 ? customCategories : undefined}
        autoFocus={true}
        perLine={8}
        emojiSize={22}
        maxFrequentRows={3}
        previewPosition="none"
        skinTonePosition="search"
      />
    </div>
  );
}
