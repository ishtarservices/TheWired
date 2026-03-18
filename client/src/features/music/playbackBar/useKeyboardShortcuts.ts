import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  togglePlay,
  nextTrack,
  prevTrack,
  setVolume,
  toggleMute,
  setBarMode,
  toggleNowPlaying,
} from "@/store/slices/musicSlice";
import { getAudio } from "../useAudioPlayer";
import { store } from "@/store";

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts() {
  const dispatch = useAppDispatch();
  const hasTrack = useAppSelector((s) => !!s.music.player.currentTrackId);

  useEffect(() => {
    if (!hasTrack) return;

    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      switch (e.key) {
        case " ": {
          e.preventDefault();
          dispatch(togglePlay());
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const audio = getAudio();
          audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const audio = getAudio();
          audio.currentTime = Math.max(0, audio.currentTime - 5);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const vol = store.getState().music.player.volume;
          dispatch(setVolume(Math.min(1, vol + 0.05)));
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const vol = store.getState().music.player.volume;
          dispatch(setVolume(Math.max(0, vol - 0.05)));
          break;
        }
        case "m":
        case "M": {
          dispatch(toggleMute());
          break;
        }
        case "n":
        case "N": {
          dispatch(nextTrack());
          break;
        }
        case "p":
        case "P": {
          dispatch(prevTrack());
          break;
        }
        case "Escape": {
          const state = store.getState().music.player;
          if (state.nowPlayingOpen) {
            dispatch(toggleNowPlaying());
          } else if (state.barMode === "expanded") {
            dispatch(setBarMode("mini"));
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch, hasTrack]);
}
