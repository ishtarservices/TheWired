import { useState, type ReactNode } from "react";
import {
  Hand,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Pin,
  PinOff,
  Scan,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useLiveKitTrack } from "@/features/voice/useLiveKitTrack";
import { VideoSurface } from "./VideoSurface";
import type { MediaTileModel } from "./types";
import type { TileFit } from "@/types/calling";

export interface MediaTileProps {
  tile: MediaTileModel;
  fit: TileFit;
  /** Small filmstrip rendering: smaller text/avatar, fewer controls. */
  compact?: boolean;
  isOnStage?: boolean;
  isPinned?: boolean;
  onFocus?: () => void;
  onExitFocus?: () => void;
  onPin?: () => void;
  onToggleFit?: () => void;
  onStopLocalShare?: () => void;
  /** Extra toolbar controls (e.g. per-user volume). */
  extras?: ReactNode;
}

/**
 * One participant/screen tile. Fills its parent; positioning is the
 * layout's job. Double-click enlarges; the hover toolbar pins, toggles
 * cover/contain, and hosts caller-provided extras.
 */
export function MediaTile({
  tile,
  fit,
  compact,
  isOnStage,
  isPinned,
  onFocus,
  onExitFocus,
  onPin,
  onToggleFit,
  onStopLocalShare,
  extras,
}: MediaTileProps) {
  const { profile } = useProfile(tile.pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? tile.displayName;
  const isShare = tile.source === "screenshare";
  const isLocalShare = isShare && tile.isLocal;
  const showVideo = tile.hasVideo && !isLocalShare;

  const track = useLiveKitTrack(tile.pubkey, tile.source, tile.isLocal);

  return (
    <div
      className={cn(
        "group relative h-full w-full overflow-hidden bg-card",
        compact ? "rounded-lg" : "rounded-2xl",
        tile.isSpeaking && !isShare ? "ring-2 ring-green-400/70" : "ring-1 ring-border/30",
      )}
      onDoubleClick={() => (isOnStage ? onExitFocus?.() : onFocus?.())}
    >
      {/* Content */}
      {isLocalShare ? (
        <LocalShareCard compact={compact} onStop={onStopLocalShare} track={track} />
      ) : showVideo ? (
        <VideoSurface
          track={track}
          fit={isShare ? "contain" : fit}
          mirror={tile.isLocal && !isShare}
          className="absolute inset-0"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="relative">
            <Avatar
              src={profile?.picture}
              alt={displayName}
              size="lg"
              className={compact ? "h-9 w-9" : "h-20 w-20"}
            />
            {tile.isSpeaking && (
              <div className="absolute -inset-1.5 rounded-full ring-2 ring-green-400 animate-pulse" />
            )}
          </div>
        </div>
      )}

      {/* Name + status overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
        <span className={cn("truncate font-medium text-white", compact ? "text-[10px]" : "text-xs")}>
          {isShare ? `${tile.isLocal ? "Your" : `${displayName}'s`} screen` : displayName}
          {tile.isLocal && !isShare ? " (You)" : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {tile.handRaised && <Hand size={10} className="text-amber-400" />}
          {isPinned && <Pin size={10} className="text-primary" />}
          {!isShare &&
            (tile.isMuted ? (
              <MicOff size={compact ? 9 : 11} className="text-red-400" />
            ) : tile.isSpeaking ? (
              <Mic size={compact ? 9 : 11} className="text-green-400" />
            ) : null)}
        </span>
      </div>

      {/* Hover toolbar */}
      {!isLocalShare && (
        <div
          className={cn(
            "absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-black/60 p-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100",
            compact && "scale-90 origin-top-right",
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {isOnStage ? (
            onExitFocus && (
              <ToolbarButton label="Back to grid" onClick={onExitFocus}>
                <Minimize2 size={13} />
              </ToolbarButton>
            )
          ) : (
            onFocus && (
              <ToolbarButton label="Enlarge" onClick={onFocus}>
                <Maximize2 size={13} />
              </ToolbarButton>
            )
          )}
          {onPin && (
            <ToolbarButton label={isPinned ? "Unpin" : "Pin to stage"} onClick={onPin} active={isPinned}>
              {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            </ToolbarButton>
          )}
          {onToggleFit && showVideo && !isShare && (
            <ToolbarButton label={fit === "cover" ? "Show whole frame" : "Fill tile"} onClick={onToggleFit}>
              <Scan size={13} />
            </ToolbarButton>
          )}
          {extras}
        </div>
      )}
    </div>
  );
}

export function ToolbarButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={cn(
        "rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white",
        active && "bg-primary/40 text-white",
      )}
    >
      {children}
    </button>
  );
}

function LocalShareCard({
  compact,
  onStop,
  track,
}: {
  compact?: boolean;
  onStop?: () => void;
  track: Parameters<typeof VideoSurface>[0]["track"];
}) {
  // Off by default: previewing your own share of the screen that contains
  // this window is the infinite-mirror effect. Useful when sharing another
  // window/monitor, so it's a toggle rather than gone.
  const [preview, setPreview] = useState(false);

  if (preview && track) {
    return (
      <div className="relative h-full w-full bg-black">
        <VideoSurface track={track} fit="contain" className="absolute inset-0" />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreview(false);
            }}
            className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90 backdrop-blur-sm hover:bg-black/75"
          >
            <EyeOff size={12} /> Hide preview
          </button>
          {onStop && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              className="flex items-center gap-1 rounded-md bg-red-500/80 px-2 py-1 text-[11px] text-white hover:bg-red-500"
            >
              <MonitorOff size={12} /> Stop
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card p-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Monitor size={compact ? 16 : 20} />
      </div>
      <div className={cn("font-semibold text-heading", compact ? "text-[11px]" : "text-sm")}>
        You&rsquo;re sharing your screen
      </div>
      {!compact && (
        <p className="max-w-[28ch] text-xs text-muted">
          Others see it live. Your own preview is off so a shared screen that contains this
          window doesn&rsquo;t mirror endlessly.
        </p>
      )}
      <div className="mt-1 flex items-center gap-2">
        {track && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreview(true);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-surface-hover font-medium text-heading transition-colors hover:bg-border-light",
              compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
            )}
          >
            <Eye size={compact ? 10 : 12} />
            Preview
          </button>
        )}
        {onStop && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-red-500/15 font-medium text-red-400 transition-colors hover:bg-red-500/25",
              compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
            )}
          >
            <MonitorOff size={compact ? 10 : 12} />
            Stop sharing
          </button>
        )}
      </div>
    </div>
  );
}
