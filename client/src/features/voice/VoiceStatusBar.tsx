import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveSpace, setActiveChannel } from "@/store/slices/spacesSlice";
import { selectIsInVoice, selectConnectedRoom, selectVoiceLocalState, selectVoiceParticipantCount } from "./voiceSelectors";
import { useVoiceChannel } from "./useVoiceChannel";
import { Mic, MicOff, PhoneOff, Headphones, Video } from "lucide-react";

/**
 * Floating status bar shown when the user is in a voice/video channel but viewing
 * a different channel. Click the label to navigate back to the connected channel.
 */
export function VoiceStatusBar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isInVoice = useAppSelector(selectIsInVoice);
  const connectedRoom = useAppSelector(selectConnectedRoom);
  const localState = useAppSelector(selectVoiceLocalState);
  const participantCount = useAppSelector(selectVoiceParticipantCount);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const channels = useAppSelector(
    (s) => (connectedRoom ? s.spaces.channels[connectedRoom.spaceId] : undefined) ?? [],
  );
  const { leave, toggleMute } = useVoiceChannel();

  const handleNavigateToChannel = useCallback(() => {
    if (!connectedRoom) return;
    dispatch(setActiveSpace(connectedRoom.spaceId));
    dispatch(setActiveChannel(`${connectedRoom.spaceId}:${connectedRoom.channelId}`));
    navigate("/");
  }, [connectedRoom, dispatch, navigate]);

  if (!isInVoice || !connectedRoom) return null;

  // Don't show if we're already viewing the connected channel
  const viewingConnectedChannel =
    activeSpaceId === connectedRoom.spaceId &&
    activeChannelId === `${connectedRoom.spaceId}:${connectedRoom.channelId}`;

  if (viewingConnectedChannel) return null;

  const channel = channels.find((c) => c.id === connectedRoom.channelId);
  const isVideoChannel = channel?.type === "video";
  const channelLabel = channel?.label ?? (isVideoChannel ? "Video Channel" : "Voice Channel");
  const ChannelIcon = isVideoChannel ? Video : Headphones;
  const statusLabel = isVideoChannel ? "Video Connected" : "Voice Connected";

  return (
    <div className="flex items-center gap-2 border-t border-green-500/20 bg-green-500/10 px-3 py-2">
      <ChannelIcon size={14} className="text-green-400 shrink-0" />

      {/* Clickable label area — navigates to the connected channel */}
      <button
        onClick={handleNavigateToChannel}
        className="min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
        title="Click to view channel"
      >
        <div className="text-xs font-semibold text-green-400">{statusLabel}</div>
        <div className="text-[10px] text-green-400/70 truncate">
          {channelLabel}
          {participantCount > 0 && (
            <span className="text-green-400/50"> — {participantCount + 1} in channel</span>
          )}
        </div>
      </button>

      <button
        onClick={toggleMute}
        className="rounded-full p-1.5 text-soft hover:bg-surface-hover transition-colors"
        title={localState.muted ? "Unmute" : "Mute"}
      >
        {localState.muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>

      <button
        onClick={leave}
        className="rounded-full p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
        title="Disconnect"
      >
        <PhoneOff size={14} />
      </button>
    </div>
  );
}
