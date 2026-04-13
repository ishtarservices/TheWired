import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import {
  Heart,
  Plus,
  Check,
  Link2,
  Pencil,
  Upload,
  Trash2,
  ListPlus,
  Download,
  FolderInput,
  Share2,
  Send,
  Globe,
  BarChart3,
  SkipForward,
  CheckCircle2,
  Music2,
  Repeat2,
  MessageSquare,
} from "lucide-react";

// ── Flash hook: returns [flashing, trigger] ──
function useFlash(duration = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), duration);
  }, [duration]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return [on, trigger];
}

interface ActionButtonProps {
  icon: ReactNode;
  confirmedIcon?: ReactNode;
  label: string;
  confirmedLabel?: string;
  onClick: () => void;
  variant?: "default" | "danger";
  fullWidth?: boolean;
  active?: boolean;
  confirmed?: boolean;
  disabled?: boolean;
}

function ActionButton({
  icon,
  confirmedIcon,
  label,
  confirmedLabel,
  onClick,
  variant = "default",
  fullWidth,
  active,
  confirmed,
  disabled,
}: ActionButtonProps) {
  const showConfirmed = confirmed && confirmedLabel;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-all duration-200 ${
        fullWidth ? "col-span-2" : ""
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${
        showConfirmed
          ? "bg-green-500/10 text-green-400"
          : variant === "danger"
            ? "text-red-400 hover:bg-red-500/10"
            : active
              ? "bg-primary/10 text-primary"
              : "text-body hover:bg-surface-hover hover:text-heading"
      }`}
    >
      <span className={`flex-none transition-transform duration-200 ${showConfirmed ? "scale-110" : ""}`}>
        {showConfirmed && confirmedIcon ? confirmedIcon : icon}
      </span>
      <span className="truncate">{showConfirmed ? confirmedLabel : label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="col-span-2 mt-1 first:mt-0 px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted/50">
      {children}
    </p>
  );
}

function SectionDivider() {
  return <div className="col-span-2 my-0.5 border-t border-border/30" />;
}

interface ActionsTabProps {
  isOwner: boolean;
  isCollaborator?: boolean;
  isLocal: boolean;
  saved: boolean;
  favorited: boolean;
  downloaded: boolean;
  isDownloading: boolean;
  sharingDisabled: boolean;
  sharingToggling: boolean;
  exporting: boolean;
  publishing: boolean;
  deleting: boolean;
  confirmDelete: boolean;
  dmSentFlash: boolean;
  spaceSharedFlash: boolean;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onSaveToggle: () => void;
  onFavoriteToggle: () => void;
  onAddToPlaylist: () => void;
  onCopyLink: () => void;
  onSendToDM: () => void;
  onShareToSpace: () => void;
  onEditTrack: () => void;
  onMove: () => void;
  onToggleSharing: () => void;
  onPublish?: () => void;
  onInsights: () => void;
  onDownload: () => void;
  onRemoveDownload: () => void;
  onExport: () => void;
  onDeleteStart: () => void;
  onDeleteConfirm: () => void;
  onShowcaseToggle?: () => void;
  inShowcase?: boolean;
  showcaseFlash?: boolean;
  onRepost?: () => void;
  repostFlash?: boolean;
  onPostWithNote?: () => void;
}

export function ActionsTab({
  isOwner,
  isCollaborator = false,
  isLocal,
  saved,
  favorited,
  downloaded,
  isDownloading,
  sharingDisabled,
  sharingToggling,
  exporting,
  publishing,
  deleting,
  confirmDelete,
  dmSentFlash,
  spaceSharedFlash,
  onPlayNext,
  onAddToQueue,
  onSaveToggle,
  onFavoriteToggle,
  onAddToPlaylist,
  onCopyLink,
  onSendToDM,
  onShareToSpace,
  onEditTrack,
  onMove,
  onToggleSharing,
  onPublish,
  onInsights,
  onDownload,
  onRemoveDownload,
  onExport,
  onDeleteStart,
  onDeleteConfirm,
  onShowcaseToggle,
  inShowcase,
  showcaseFlash,
  onRepost,
  repostFlash,
  onPostWithNote,
}: ActionsTabProps) {
  const [playNextFlash, triggerPlayNext] = useFlash();
  const [queueFlash, triggerQueue] = useFlash();
  const [linkFlash, triggerLink] = useFlash();
  const [exportFlash, triggerExport] = useFlash();

  // Detect export completion (exporting transitions from true → false)
  const prevExporting = useRef(exporting);
  useEffect(() => {
    if (prevExporting.current && !exporting) {
      triggerExport();
    }
    prevExporting.current = exporting;
  }, [exporting, triggerExport]);

  const confirmIcon = <CheckCircle2 size={14} />;

  return (
    <div className="grid grid-cols-2 px-3 py-2">
      {/* ── Play ── */}
      <SectionLabel>Play</SectionLabel>
      <ActionButton
        icon={<SkipForward size={14} />}
        confirmedIcon={confirmIcon}
        label="Play Next"
        confirmedLabel="Playing Next!"
        confirmed={playNextFlash}
        onClick={() => { onPlayNext(); triggerPlayNext(); }}
      />
      <ActionButton
        icon={<ListPlus size={14} />}
        confirmedIcon={confirmIcon}
        label="Add to Queue"
        confirmedLabel="Queued!"
        confirmed={queueFlash}
        onClick={() => { onAddToQueue(); triggerQueue(); }}
      />

      {/* ── Library (non-owner only) ── */}
      {!isOwner && !isLocal && (
        <>
          <SectionDivider />
          <SectionLabel>Library</SectionLabel>
          <ActionButton
            icon={saved ? <Check size={14} className="text-green-400" /> : <Plus size={14} />}
            label={saved ? "Saved" : "Save to Library"}
            onClick={onSaveToggle}
            active={saved}
          />
          <ActionButton
            icon={<Heart size={14} className={favorited ? "fill-red-500 text-red-500" : ""} />}
            label={favorited ? "Favorited" : "Favorite"}
            onClick={onFavoriteToggle}
            active={favorited}
          />
          <ActionButton icon={<ListPlus size={14} />} label="Add to Playlist" onClick={onAddToPlaylist} />
        </>
      )}

      {/* ── Playlist (owner) ── */}
      {isOwner && (
        <ActionButton icon={<ListPlus size={14} />} label="Add to Playlist" onClick={onAddToPlaylist} />
      )}

      {/* ── Share ── */}
      {!isLocal && (
        <>
          <SectionDivider />
          <SectionLabel>Share</SectionLabel>
          <ActionButton
            icon={<Link2 size={14} />}
            confirmedIcon={<Check size={14} />}
            label="Copy Link"
            confirmedLabel="Link Copied!"
            confirmed={linkFlash}
            onClick={() => { onCopyLink(); triggerLink(); }}
          />
          <ActionButton
            icon={<Send size={14} />}
            confirmedIcon={confirmIcon}
            label="Send to DM"
            confirmedLabel="Sent!"
            confirmed={dmSentFlash}
            onClick={onSendToDM}
          />
          <ActionButton
            icon={<Globe size={14} />}
            confirmedIcon={confirmIcon}
            label="Share to Space"
            confirmedLabel="Shared!"
            confirmed={spaceSharedFlash}
            onClick={onShareToSpace}
          />
          {onRepost && (
            <ActionButton
              icon={<Repeat2 size={14} />}
              confirmedIcon={confirmIcon}
              label="Repost"
              confirmedLabel="Reposted!"
              confirmed={repostFlash}
              onClick={onRepost}
            />
          )}
          {onPostWithNote && (
            <ActionButton
              icon={<MessageSquare size={14} />}
              label="Post with Note"
              onClick={onPostWithNote}
            />
          )}
        </>
      )}

      {/* ── Profile Library ── */}
      {onShowcaseToggle && !isLocal && (
        <>
          <SectionDivider />
          <SectionLabel>Profile</SectionLabel>
          <ActionButton
            icon={<Music2 size={14} className={inShowcase ? "text-primary" : ""} />}
            confirmedIcon={confirmIcon}
            label={inShowcase ? "In Profile Library" : "Add to Profile Library"}
            confirmedLabel={inShowcase ? "Removed!" : "Added!"}
            confirmed={showcaseFlash}
            onClick={onShowcaseToggle}
            active={inShowcase}
          />
        </>
      )}

      {/* ── Manage (owner or collaborator) ─��� */}
      {(isOwner || isCollaborator) && (
        <>
          <SectionDivider />
          <SectionLabel>Manage</SectionLabel>
          <ActionButton icon={<Pencil size={14} />} label="Edit Track" onClick={onEditTrack} />
          {isOwner && <ActionButton icon={<FolderInput size={14} />} label="Move" onClick={onMove} />}
          <ActionButton icon={<BarChart3 size={14} />} label="Insights" onClick={onInsights} />
          {!isLocal && (
            <ActionButton
              icon={<Share2 size={14} className={sharingDisabled ? "text-muted" : "text-green-400"} />}
              label={
                sharingToggling
                  ? "Toggling..."
                  : sharingDisabled
                    ? "Sharing: Off"
                    : "Sharing: On"
              }
              onClick={onToggleSharing}
              active={!sharingDisabled}
              disabled={sharingToggling}
            />
          )}
          {isLocal && onPublish && (
            <ActionButton
              icon={<Upload size={14} />}
              label={publishing ? "Publishing..." : "Publish"}
              onClick={onPublish}
              disabled={publishing}
            />
          )}
        </>
      )}

      {/* ── File ── */}
      <SectionDivider />
      <SectionLabel>File</SectionLabel>
      {downloaded ? (
        <ActionButton
          icon={<Download size={14} className="text-green-400" />}
          label="Remove Download"
          onClick={onRemoveDownload}
        />
      ) : (
        <ActionButton
          icon={<Download size={14} />}
          label={isDownloading ? "Downloading..." : "Download"}
          onClick={onDownload}
          disabled={isDownloading}
        />
      )}
      {(isOwner || !sharingDisabled) && (
        <ActionButton
          icon={<Download size={14} />}
          confirmedIcon={confirmIcon}
          label={exporting ? "Exporting..." : "Export File"}
          confirmedLabel="Exported!"
          confirmed={exportFlash}
          onClick={onExport}
          disabled={exporting}
        />
      )}

      {/* ── Danger (owner) ── */}
      {isOwner && (
        <>
          <SectionDivider />
          {confirmDelete ? (
            <ActionButton
              icon={<Trash2 size={14} />}
              label={deleting ? "Deleting..." : "Confirm Delete"}
              variant="danger"
              fullWidth
              onClick={onDeleteConfirm}
              disabled={deleting}
            />
          ) : (
            <ActionButton
              icon={<Trash2 size={14} />}
              label="Delete Track"
              variant="danger"
              fullWidth
              onClick={onDeleteStart}
            />
          )}
        </>
      )}
    </div>
  );
}
