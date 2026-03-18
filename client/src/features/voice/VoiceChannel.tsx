import { useAppSelector } from "@/store/hooks";
import { useVoiceChannel } from "./useVoiceChannel";
import { useVoiceParticipants } from "./useVoiceParticipants";
import { VoiceParticipant } from "./VoiceParticipant";
import { VoiceControls } from "./VoiceControls";
import { VideoGrid } from "./VideoGrid";
import { ScreenShareView } from "./ScreenShareView";
import { Headphones, Video, Users, Wifi, WifiOff } from "lucide-react";
import { parseChannelIdPart } from "@/features/spaces/spaceSelectors";

/**
 * Main voice/video channel view.
 *
 * - Pre-join: shows channel info, participant preview, join button
 * - Connected (voice): avatar grid for audio-only, video grid when anyone has camera on
 * - Connected (video): video grid always, with local camera tile
 * - Screen share: full-width screen with participant sidebar
 */
export function VoiceChannel() {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const channels = useAppSelector(
    (s) => (activeSpaceId ? s.spaces.channels[activeSpaceId] : undefined) ?? [],
  );

  const channelIdPart = parseChannelIdPart(activeChannelId);
  const channel = channels.find((c) => c.id === channelIdPart);
  const isVideoChannel = channel?.type === "video";

  const {
    isConnecting,
    connectedRoom,
    connectionQuality,
    join,
  } = useVoiceChannel();

  const { sortedParticipants, count } = useVoiceParticipants();

  const isConnectedToThis =
    connectedRoom &&
    connectedRoom.spaceId === activeSpaceId &&
    connectedRoom.channelId === channelIdPart;

  const screenSharer = sortedParticipants.find((p) => p.isScreenSharing);
  const hasVideoParticipants = sortedParticipants.some((p) => p.hasVideo);

  if (!activeSpaceId || !channelIdPart) return null;

  const ChannelIcon = isVideoChannel ? Video : Headphones;
  const channelTypeLabel = isVideoChannel ? "Video" : "Voice";

  // ─── Pre-join view ──────────────────────────────────────────
  if (!isConnectedToThis) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface/50">
          <ChannelIcon size={32} className="text-muted" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-heading">
            {channel?.label ?? `${channelTypeLabel} Channel`}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {count > 0
              ? `${count} participant${count !== 1 ? "s" : ""} connected`
              : "No one is here yet"}
          </p>
        </div>

        {count > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {sortedParticipants.map((p) => (
              <VoiceParticipant key={p.pubkey} participant={p} compact />
            ))}
          </div>
        )}

        <button
          onClick={() => join(activeSpaceId, channelIdPart)}
          disabled={isConnecting}
          className="rounded-xl bg-green-500/20 px-8 py-3 text-sm font-semibold text-green-400 hover:bg-green-500/30 transition-colors disabled:opacity-50"
        >
          {isConnecting ? "Connecting..." : `Join ${channelTypeLabel}`}
        </button>

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
    <div className="flex flex-1 flex-col overflow-hidden bg-black/20">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-edge/50 bg-surface/30 px-4 py-2 backdrop-blur-sm">
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
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden p-2">
        {screenSharer ? (
          // Screen share mode: full-width screen + sidebar tiles
          <ScreenShareView
            screenSharerPubkey={screenSharer.pubkey}
            participants={sortedParticipants}
          />
        ) : (isVideoChannel || hasVideoParticipants) ? (
          // Video grid: all participants in adaptive grid with video
          <VideoGrid participants={sortedParticipants} showLocal />
        ) : (
          // Voice-only: avatar tiles in a grid
          <VideoGrid participants={sortedParticipants} showLocal />
        )}
      </div>

      {/* Controls bar */}
      <VoiceControls showVideo={isVideoChannel} />
    </div>
  );
}
