import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Zap } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useProfile } from "@/features/profile/useProfile";
import { useZap } from "../wallet/WalletProvider";
import { getZapTargets, type ZapArtist, type ZappableMusicItem } from "./musicZapTargets";

/** A track or album: the zappable-artist fields plus the publisher pubkey used
 *  for the "tip uploader" fallback. */
interface ZapMusicItem extends ZappableMusicItem {
  pubkey: string;
}

export interface ArtistZapState {
  /** Click handler: zaps directly (1 artist), opens the picker (>1), or tips
   *  the uploader (0). */
  onZap: () => void;
  /** Context-aware button label. */
  label: string;
  /** Number of distinct zappable artists (0 → uploader fallback). */
  count: number;
  /** Picker modal node to render; null unless the picker is open. */
  picker: ReactNode;
}

/**
 * Shared artist-zap behavior for every music surface, so the multi-artist /
 * no-npub decisions live in exactly one place. Returns a click handler, a label,
 * and a `picker` node the caller renders alongside its own UI.
 */
export function useArtistZap(item: ZapMusicItem): ArtistZapState {
  const { openZap } = useZap();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Credited artists + the uploader (when distinct). Always ≥ 1 target.
  const targets = useMemo(
    () => getZapTargets(item),
    [item.pubkey, item.artist, item.artistPubkeys, item.featuredArtists],
  );

  const onZap = useCallback(() => {
    if (targets.length === 1) {
      openZap({ recipientPubkey: targets[0].pubkey });
    } else {
      setPickerOpen(true);
    }
  }, [targets, openZap]);

  const label =
    targets.length === 1 && targets[0].role === "uploader"
      ? "Tip uploader"
      : targets.length > 1
        ? "Zap artists"
        : "Zap artist";

  const picker = pickerOpen ? (
    <ArtistZapPicker
      artists={targets}
      onClose={() => setPickerOpen(false)}
      onPick={(pk) => {
        setPickerOpen(false);
        openZap({ recipientPubkey: pk });
      }}
    />
  ) : null;

  return { onZap, label, count: targets.length, picker };
}

interface ArtistZapButtonProps {
  item: ZapMusicItem;
  variant?: "icon" | "labeled";
  /** Override the default button styling (e.g. to match an action grid). */
  className?: string;
}

/** Self-contained zap affordance for cards, headers, and the now-playing panel. */
export function ArtistZapButton({ item, variant = "icon", className }: ArtistZapButtonProps) {
  const { onZap, label, picker } = useArtistZap(item);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onZap();
        }}
        title={label}
        className={
          className ??
          (variant === "labeled"
            ? "flex items-center gap-2 rounded-full bg-yellow-400/10 px-3.5 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-400/20"
            : "rounded-lg p-1.5 text-muted transition-colors hover:bg-yellow-400/10 hover:text-yellow-400")
        }
      >
        <Zap size={variant === "labeled" ? 14 : 16} />
        {variant === "labeled" && <span>{label}</span>}
      </button>
      {picker}
    </>
  );
}

function ArtistZapPicker({
  artists,
  onClose,
  onPick,
}: {
  artists: ZapArtist[];
  onClose: () => void;
  onPick: (pubkey: string) => void;
}) {
  return (
    <Modal open onClose={onClose}>
      <div className="w-full max-w-xs rounded-2xl border-gradient card-glass p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-heading">
          <Zap size={16} className="text-yellow-400" />
          Choose an artist to zap
        </h3>
        <div className="space-y-1">
          {artists.map((a) => (
            <ArtistZapRow key={a.pubkey} artist={a} onPick={() => onPick(a.pubkey)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ArtistZapRow({ artist, onPick }: { artist: ZapArtist; onPick: () => void }) {
  const { profile } = useProfile(artist.pubkey);
  const name =
    profile?.display_name || profile?.name || artist.pubkey.slice(0, 8) + "…";
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-heading">{name}</div>
        {artist.role !== "primary" && (
          <div className="text-[10px] uppercase tracking-wider text-muted">
            {artist.role === "featured" ? "Featured" : "Uploader"}
          </div>
        )}
      </div>
      <Zap size={14} className="shrink-0 text-yellow-400" />
    </button>
  );
}
