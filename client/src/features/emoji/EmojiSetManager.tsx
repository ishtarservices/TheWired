import { useState, useCallback } from "react";
import { Trash2, Upload } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { addEmojiSet } from "@/store/slices/emojiSlice";
import { buildEmojiSetEvent } from "./emojiSetBuilder";
import { parseEmojiSetEvent } from "./emojiSetParser";
import { signAndPublish } from "@/lib/nostr/publish";
import { blossomUpload } from "@/lib/api/blossom";
import type { CustomEmoji } from "@/types/emoji";

interface EmojiSetManagerProps {
  spaceId: string;
}

const MAX_EMOJI_SIZE = 256 * 1024; // 256KB per Discord convention
const ACCEPTED_TYPES = ["image/png", "image/gif", "image/webp", "image/jpeg"];

const EMPTY_IDS: string[] = [];

export function EmojiSetManager({ spaceId }: EmojiSetManagerProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const emojiSets = useAppSelector((s) => s.emoji.emojiSets);
  const spaceSetIds = useAppSelector((s) => s.emoji.spaceEmojiSets[spaceId] ?? EMPTY_IDS);
  const dispatch = useAppDispatch();

  const [shortcode, setShortcode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gather all emojis from space sets
  const spaceEmojis: CustomEmoji[] = [];
  for (const setId of spaceSetIds) {
    const set = emojiSets[setId];
    if (set) {
      spaceEmojis.push(...set.emojis);
    }
  }

  const handleUpload = useCallback(
    async (file: File) => {
      if (!pubkey) return;

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Only PNG, GIF, WebP, and JPEG images are allowed");
        return;
      }
      if (file.size > MAX_EMOJI_SIZE) {
        setError("Image must be under 256KB");
        return;
      }
      if (!shortcode.trim() || !/^[a-zA-Z0-9_]+$/.test(shortcode.trim())) {
        setError("Shortcode must be alphanumeric + underscores only");
        return;
      }

      setError(null);
      setUploading(true);

      try {
        // Upload to Blossom
        const result = await blossomUpload(file);

        // Build updated emoji list
        const newEmoji: CustomEmoji = {
          shortcode: shortcode.trim(),
          url: result.url,
        };
        const allEmojis = [...spaceEmojis, newEmoji];

        // Publish updated kind:30030 event
        const dTag = `space-${spaceId}`;
        const unsigned = buildEmojiSetEvent(
          pubkey,
          dTag,
          "Space Emojis",
          allEmojis,
          spaceId,
        );
        const signed = await signAndPublish(unsigned);

        // Index locally
        const emojiSet = parseEmojiSetEvent(signed);
        dispatch(addEmojiSet(emojiSet));

        setShortcode("");
      } catch (err) {
        setError((err as Error).message || "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [pubkey, spaceId, shortcode, spaceEmojis, dispatch],
  );

  const handleRemoveEmoji = useCallback(
    async (shortcodeToRemove: string) => {
      if (!pubkey) return;

      const updatedEmojis = spaceEmojis.filter(
        (e) => e.shortcode !== shortcodeToRemove,
      );

      const dTag = `space-${spaceId}`;
      const unsigned = buildEmojiSetEvent(
        pubkey,
        dTag,
        "Space Emojis",
        updatedEmojis,
        spaceId,
      );
      const signed = await signAndPublish(unsigned);
      const emojiSet = parseEmojiSetEvent(signed);
      dispatch(addEmojiSet(emojiSet));
    },
    [pubkey, spaceId, spaceEmojis, dispatch],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      e.target.value = "";
    },
    [handleUpload],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-heading">Custom Emojis</h3>
        <span className="text-xs text-muted">{spaceEmojis.length} emojis</span>
      </div>

      {/* Emoji grid */}
      {spaceEmojis.length > 0 ? (
        <div className="grid grid-cols-6 gap-2">
          {spaceEmojis.map((emoji) => (
            <div
              key={emoji.shortcode}
              className="group relative flex flex-col items-center gap-1 rounded-lg border border-border p-2 hover:bg-surface-hover transition-colors"
            >
              <img
                src={emoji.url}
                alt={`:${emoji.shortcode}:`}
                className="h-8 w-8 object-contain"
              />
              <span className="text-[10px] text-muted truncate max-w-full">
                :{emoji.shortcode}:
              </span>
              <button
                type="button"
                onClick={() => handleRemoveEmoji(emoji.shortcode)}
                className="absolute -top-1 -right-1 rounded-full bg-red-500/80 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          No custom emojis yet. Add one below.
        </div>
      )}

      {/* Add new emoji */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={shortcode}
            onChange={(e) => {
              setShortcode(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""));
              setError(null);
            }}
            placeholder="shortcode"
            className="flex-1 rounded-lg bg-field px-3 py-1.5 text-sm text-heading placeholder:text-muted ring-1 ring-border outline-none focus:ring-primary/50"
            maxLength={32}
          />
          <label className="flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary cursor-pointer hover:bg-primary/25 transition-colors">
            <Upload size={14} />
            {uploading ? "Uploading..." : "Upload"}
            <input
              type="file"
              accept="image/png,image/gif,image/webp,image/jpeg"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading || !shortcode.trim()}
            />
          </label>
        </div>
        {shortcode && (
          <div className="text-[11px] text-muted">
            Preview: <span className="text-heading">:{shortcode}:</span>
          </div>
        )}
        {error && (
          <div className="text-[11px] text-red-400">{error}</div>
        )}
      </div>
    </div>
  );
}
