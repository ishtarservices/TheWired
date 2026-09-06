import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { useVoiceChannel } from "./useVoiceChannel";
import { useVoiceParticipants } from "./useVoiceParticipants";
import { selectChannelPresence } from "./voiceSelectors";
import { VoiceControls } from "./VoiceControls";
import { VoiceStage } from "./VoiceStage";
import { VoiceBanners } from "./VoiceBanners";
import { Headphones, Video, Users, Wifi, WifiOff, Lock, Maximize2, Minimize2, Expand } from "lucide-react";
import { toggleWindowFullscreen } from "@/lib/tauriWindow";
import { parseChannelIdPart } from "@/features/spaces/spaceSelectors";
import { usePermissions } from "@/features/spaces/usePermissions";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { NowPlayingStrip } from "@/features/listenTogether/NowPlayingStrip";
import { NowPlayingPanel } from "@/features/listenTogether/NowPlayingPanel";
import { ListenTogetherPicker } from "@/features/listenTogether/ListenTogetherPicker";
import { ListenTogetherInvite } from "@/features/listenTogether/ListenTogetherInvite";

/**
 * Main voice/video channel view.
 *
 * - Pre-join: shows channel info, participant preview, join button
 * - Connected: MediaStage (fitted grid, focus/pin, screen-share tiles)
 */
const EMPTY_CHANNELS: never[] = [];

export function VoiceChannel() {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const channels = useAppSelector(
    (s) => (activeSpaceId ? s.spaces.channels[activeSpaceId] : undefined) ?? EMPTY_CHANNELS,
  );
  const ltActive = useAppSelector((s) => s.listenTogether.active);
  const ltPickerOpen = useAppSelector((s) => s.listenTogether.pickerOpen);
  const [nowPlayingExpanded, setNowPlayingExpanded] = useState(false);
  const [stageExpanded, setStageExpanded] = useState(false);
  const layoutMode = useAppSelector((s) => s.voice.layout.mode);
  const joinError = useAppSelector((s) => (s.voice.connectedRoom ? null : s.voice.mediaError));
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  const channelIdPart = parseChannelIdPart(activeChannelId);
  const channel = channels.find((c) => c.id === channelIdPart);
  const isVideoChannel = channel?.type === "video";
  const { can } = usePermissions(activeSpaceId);
  const canConnect = can("CONNECT", channelIdPart);

  const {
    isConnecting,
    connectedRoom,
    connectionQuality,
    join,
  } = useVoiceChannel();

  const { count } = useVoiceParticipants();

  // Escape leaves the expanded stage (after the stage's own focus-exit).
  useEffect(() => {
    if (!stageExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || layoutMode === "focus") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setStageExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stageExpanded, layoutMode]);

  const isConnectedToThis =
    connectedRoom &&
    connectedRoom.spaceId === activeSpaceId &&
    connectedRoom.channelId === channelIdPart;

  // API presence data for pre-join view (visible without connecting)
  const channelPresence = useAppSelector(selectChannelPresence(channelIdPart ?? ""));
  const presenceCount = channelPresence?.participantCount ?? 0;

  if (!activeSpaceId || !channelIdPart) return null;

  const ChannelIcon = isVideoChannel ? Video : Headphones;
  const channelTypeLabel = isVideoChannel ? "Video" : "Voice";

  // ─── Pre-join view ──────────────────────────────────────────
  if (!isConnectedToThis) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-card-hover">
          <ChannelIcon size={32} className="text-muted" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-heading">
            {channel?.label ?? `${channelTypeLabel} Channel`}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {presenceCount > 0
              ? `${presenceCount} participant${presenceCount !== 1 ? "s" : ""} connected`
              : "No one is here yet"}
          </p>
        </div>

        {channelPresence && channelPresence.participants.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3">
            {channelPresence.participants.map((p) => (
              <PresenceAvatar key={p.pubkey} pubkey={p.pubkey} />
            ))}
          </div>
        )}

        {canConnect ? (
          <button
            onClick={() => void join(activeSpaceId, channelIdPart).catch(() => {})}
            disabled={isConnecting}
            className="rounded-xl bg-green-600/15 px-8 py-3 text-sm font-semibold text-green-600 hover:bg-green-600/25 transition-colors disabled:opacity-50"
          >
            {isConnecting ? "Connecting..." : `Join ${channelTypeLabel}`}
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-surface-hover px-6 py-3 text-sm text-muted">
            <Lock size={14} />
            <span>You don't have permission to join this channel</span>
          </div>
        )}

        {joinError && (
          <p className="max-w-md rounded-xl bg-red-500/10 px-4 py-2 text-center text-xs text-red-400">
            {joinError}
          </p>
        )}

        {connectedRoom && !isConnectedToThis && (
          <p className="text-xs text-muted">
            You're connected to another voice channel.
            Joining will disconnect you from it.
          </p>
        )}
      </div>
    );
  }

  // ─── Connected view ─────────────────────────────────────────
  return (
    <div
      className={
        stageExpanded
          ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
          : `relative flex flex-1 flex-col overflow-hidden bg-card ${scrollPaddingClass}`
      }
    >
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 bg-panel/80 backdrop-blur-sm">
        <ChannelIcon size={16} className="text-green-400" />
        <span className="text-sm font-medium text-heading">
          {channel?.label ?? `${channelTypeLabel} Channel`}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <Users size={12} />
          {count + 1}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs">
          {connectionQuality === "poor" ? (
            <WifiOff size={12} className="text-red-400" />
          ) : (
            <Wifi size={12} className="text-green-400" />
          )}
          <span className="text-muted capitalize">{connectionQuality}</span>
        </span>
        <button
          onClick={() => setStageExpanded((v) => !v)}
          className="rounded-full p-1 text-muted transition-colors hover:bg-surface-hover hover:text-heading"
          title={stageExpanded ? "Exit expanded view (Esc)" : "Expand video area"}
          aria-label={stageExpanded ? "Exit expanded view" : "Expand video area"}
        >
          {stageExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={() => void toggleWindowFullscreen()}
          className="rounded-full p-1 text-muted transition-colors hover:bg-surface-hover hover:text-heading"
          title="Toggle window fullscreen"
          aria-label="Toggle window fullscreen"
        >
          <Expand size={14} />
        </button>
      </div>

      {/* Autoplay-policy recovery (WebView2/WKWebView block silent starts) */}
      <VoiceBanners />

      {/* Listen Together: invite banner (when not yet joined) */}
      {!ltActive && <ListenTogetherInvite />}

      {/* Listen Together: now-playing strip in header */}
      {ltActive && !nowPlayingExpanded && (
        <NowPlayingStrip onExpand={() => setNowPlayingExpanded(true)} />
      )}

      {/* Listen Together: expanded now-playing panel */}
      {ltActive && nowPlayingExpanded && (
        <NowPlayingPanel onClose={() => setNowPlayingExpanded(false)} />
      )}

      {/* Stage: grid / focus / screen share, one layout engine */}
      <div className="flex-1 overflow-hidden p-2">
        <VoiceStage />
      </div>

      {/* Controls bar */}
      <VoiceControls
        showVideo={isVideoChannel}
        canSpeak={can("SPEAK", channelIdPart)}
        canVideo={can("VIDEO", channelIdPart)}
        canScreenShare={can("SCREEN_SHARE", channelIdPart)}
      />

      {/* Listen Together: music picker drawer */}
      {ltPickerOpen && <ListenTogetherPicker />}
    </div>
  );
}

/** Simple avatar for pre-join presence display */
function PresenceAvatar({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? pubkey.slice(0, 8);

  return (
    <div className="flex flex-col items-center gap-1">
      <Avatar src={profile?.picture} alt={displayName} size="md" />
      <span className="text-xs text-muted truncate max-w-[72px]">{displayName}</span>
    </div>
  );
}
