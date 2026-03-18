import { AnimatePresence } from "motion/react";
import { useAppSelector } from "@/store/hooks";
import { ExpandedBar } from "./ExpandedBar";
import { MiniBar } from "./MiniBar";
import { NowPlayingOverlay } from "./NowPlayingOverlay";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

export function FloatingPlaybackBar() {
  const barMode = useAppSelector((s) => s.music.player.barMode);
  const nowPlayingOpen = useAppSelector((s) => s.music.player.nowPlayingOpen);

  useKeyboardShortcuts();

  return (
    <>
      <AnimatePresence mode="wait">
        {barMode === "expanded" ? <ExpandedBar /> : <MiniBar />}
      </AnimatePresence>
      <AnimatePresence>
        {nowPlayingOpen && <NowPlayingOverlay />}
      </AnimatePresence>
    </>
  );
}
