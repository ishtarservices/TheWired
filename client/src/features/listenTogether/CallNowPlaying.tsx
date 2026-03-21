import { Play, Pause, SkipBack, SkipForward, Music, Crown } from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useAppSelector } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import { getTrackImage } from "@/features/music/trackImage";
import { ReactionOverlay } from "./ReactionOverlay";

/**
 * Now-playing strip sized for the DM CallController panel.
 * In audio-only calls, provides album art background + track info.
 */
export function CallNowPlaying() {
  const { active, isLocalDJ, djPubkey, reactions, react } =
    useListenTogether();
  const { currentTrack, player, togglePlay, next, prev } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const { profile: djProfile } = useProfile(djPubkey ?? "");

  if (!active || !currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);
  const djName =
    djProfile?.name ?? djProfile?.display_name ?? djPubkey?.slice(0, 8) ?? "DJ";

  return (
    <div className="relative border-t border-edge bg-field">
      <ReactionOverlay reactions={reactions} />

      {/* Album art background blur */}
      {imageUrl && (
        <div className="absolute inset-0 overflow-hidden opacity-20">
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover blur-2xl scale-110"
          />
        </div>
      )}

      <div className="relative flex items-center gap-3 px-4 py-2.5">
        {/* Album art */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={currentTrack.title}
            className="h-10 w-10 rounded-lg object-cover shadow-md shrink-0"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover shrink-0">
            <Music size={16} className="text-muted" />
          </div>
        )}

        {/* Track info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-heading">
            {currentTrack.title}
          </p>
          <p className="truncate text-[10px] text-soft">
            {currentTrack.artist}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="flex items-center gap-0.5 text-[9px] text-pulse">
              <Crown size={8} />
              {djName}
            </span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-1 shrink-0">
          {isLocalDJ ? (
            <>
              <button
                onClick={prev}
                className="rounded-full p-1 text-soft hover:text-heading transition-colors"
              >
                <SkipBack size={14} />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-card-hover text-heading hover:bg-edge-light transition-colors"
              >
                {player.isPlaying ? (
                  <Pause size={12} fill="currentColor" />
                ) : (
                  <Play size={12} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button
                onClick={next}
                className="rounded-full p-1 text-soft hover:text-heading transition-colors"
              >
                <SkipForward size={14} />
              </button>
            </>
          ) : (
            <span className="text-[10px] text-muted px-1">
              DJ controlling
            </span>
          )}
        </div>
      </div>

      {/* Reaction buttons */}
      <div className="relative flex items-center gap-0.5 px-4 pb-2">
        {["\uD83D\uDD25", "\u2764\uFE0F", "\uD83D\uDE0D", "\uD83C\uDFB6"].map((emoji) => (
          <button
            key={emoji}
            onClick={() => react(emoji)}
            className="rounded-full px-1.5 py-0.5 text-xs hover:bg-card-hover transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
