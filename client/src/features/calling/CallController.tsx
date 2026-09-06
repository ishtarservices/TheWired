import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setPanelMode, setPipCorner, swapCallTiles, toggleCallScreenShare } from "@/store/slices/callSlice";
import {
  focusTile,
  pinTile,
  setLayoutMode,
  toggleAutoFocusSpeaker,
  setTileFit,
} from "@/store/slices/voiceSlice";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { toggleWindowFullscreen } from "@/lib/tauriWindow";
import { MediaStage } from "@/features/media/MediaStage";
import { MediaTile } from "@/features/media/MediaTile";
import { nearestCorner } from "@/features/media/layout/nearestCorner";
import type { MediaTileModel } from "@/features/media/types";
import { VoiceBanners } from "@/features/voice/VoiceBanners";
import { TileVolumeControl } from "@/features/voice/TileVolumeControl";
import { CallNowPlaying } from "@/features/listenTogether/CallNowPlaying";
import { ListenTogetherPicker } from "@/features/listenTogether/ListenTogetherPicker";
import { ListenTogetherInvite } from "@/features/listenTogether/ListenTogetherInvite";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { CallControls } from "./CallControls";
import { useCallTiles } from "./useCallTiles";
import { playCallEnd, startRingback, stopRingback } from "./callRingtone";
import { setCallScreenShare } from "./callService";
import { Loader2, Maximize2, Minimize2, Expand, Shrink, Wifi } from "lucide-react";
import type { PipCorner, TileFit } from "@/types/calling";

const WIDTH_KEY = "thewired.call.panelWidth";
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;

/**
 * Active 1:1 call chrome around the shared media stage.
 *
 * - floating:  corner panel (resizable), remote on the stage + local PiP
 * - expanded:  full-window overlay on the MediaStage (grid/focus/pin)
 * - minimized: small chip
 */
export function CallController() {
  const dispatch = useAppDispatch();
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const panelMode = useAppSelector((s) => s.call.panelMode);
  const ltActive = useAppSelector((s) => s.listenTogether.active);
  const ltPickerOpen = useAppSelector((s) => s.listenTogether.pickerOpen);
  const layoutMode = useAppSelector((s) => s.voice.layout.mode);
  const { inputMarginClass } = usePlaybackBarSpacing();

  const partnerPubkey = activeCall?.partnerPubkey ?? "";
  const { profile } = useProfile(partnerPubkey);
  const displayName = profile?.name ?? profile?.display_name ?? partnerPubkey.slice(0, 12);

  // Outgoing ringback while the invite is out — the caller otherwise sits in
  // silence with no cue that anything is happening.
  const ringingOutgoing = activeCall?.direction === "outgoing" && activeCall.state === "ringing";
  useEffect(() => {
    if (ringingOutgoing) startRingback();
    else stopRingback();
    return () => stopRingback();
  }, [ringingOutgoing]);

  // Play end sound on unmount
  useEffect(() => {
    return () => {
      if (activeCall) playCallEnd();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape collapses the expanded overlay (the stage handles its own focus-exit first).
  useEffect(() => {
    if (panelMode !== "expanded") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || layoutMode === "focus") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      dispatch(setPanelMode("floating"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelMode, layoutMode, dispatch]);

  if (!activeCall) return null;

  const isConnecting = activeCall.state === "connecting" || activeCall.state === "ringing";
  const statusText = activeCall.state === "ringing" ? "Ringing…" : "Connecting…";
  const timer = <CallTimer startedAt={activeCall.connectedAt ?? activeCall.startedAt} />;

  // ─── Minimized chip ─────────────────────────────────────────
  if (panelMode === "minimized") {
    return (
      <div
        className={cn(
          "fixed bottom-4 right-4 z-40 flex cursor-pointer items-center gap-3 rounded-2xl card-glass px-4 py-3 shadow-xl transition-colors hover:bg-surface-hover",
          inputMarginClass,
        )}
        onClick={() => dispatch(setPanelMode("floating"))}
        title="Show call"
      >
        <div className="relative">
          <Avatar src={profile?.picture} alt={displayName} size="sm" />
          {activeCall.state === "active" && (
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-surface bg-green-400" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-heading">{displayName}</div>
          <div className="text-[10px] text-muted">{isConnecting ? statusText : timer}</div>
        </div>
        <Maximize2 size={14} className="shrink-0 text-muted" />
      </div>
    );
  }

  // ─── Expanded overlay ───────────────────────────────────────
  if (panelMode === "expanded") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur-sm">
          <Avatar src={profile?.picture} alt={displayName} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-heading">{displayName}</div>
            <div className="text-xs text-muted">
              {isConnecting ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> {statusText}
                </span>
              ) : (
                timer
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <HeaderButton label="Toggle window fullscreen" onClick={() => void toggleWindowFullscreen()}>
              <Expand size={16} />
            </HeaderButton>
            <HeaderButton label="Back to floating panel" onClick={() => dispatch(setPanelMode("floating"))}>
              <Shrink size={16} />
            </HeaderButton>
            <HeaderButton label="Minimize" onClick={() => dispatch(setPanelMode("minimized"))}>
              <Minimize2 size={16} />
            </HeaderButton>
          </div>
        </div>

        <VoiceBanners />
        {!ltActive && <ListenTogetherInvite />}
        {ltActive && <CallNowPlaying />}

        <div className="flex-1 overflow-hidden p-2">
          <ExpandedCallStage partnerName={displayName} partnerPicture={profile?.picture} statusText={isConnecting ? statusText : null} />
        </div>

        <div className="border-t border-border bg-panel/80 px-4 py-3 backdrop-blur-sm">
          <CallControls />
        </div>
        {ltPickerOpen && <ListenTogetherPicker />}
      </div>
    );
  }

  // ─── Floating panel ─────────────────────────────────────────
  return (
    <FloatingPanel className={inputMarginClass}>
      <div className="flex items-center justify-between bg-surface/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-heading">{displayName}</span>
          <span className="text-xs text-muted">
            {isConnecting ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                {statusText}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-green-400">
                <Wifi size={10} />
                {timer}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <HeaderButton label="Expand" onClick={() => dispatch(setPanelMode("expanded"))}>
            <Maximize2 size={14} />
          </HeaderButton>
          <HeaderButton label="Minimize" onClick={() => dispatch(setPanelMode("minimized"))}>
            <Minimize2 size={14} />
          </HeaderButton>
        </div>
      </div>

      <VoiceBanners />

      <FloatingCallStage
        partnerName={displayName}
        partnerPicture={profile?.picture}
        statusText={isConnecting ? statusText : null}
        onExpand={() => dispatch(setPanelMode("expanded"))}
      />

      {!ltActive && <ListenTogetherInvite />}
      {ltActive && <CallNowPlaying />}

      <div className="bg-surface/50 px-3 py-3">
        <CallControls />
      </div>

      {ltPickerOpen && <ListenTogetherPicker />}
    </FloatingPanel>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-full p-1 text-muted transition-colors hover:bg-surface-hover hover:text-heading"
    >
      {children}
    </button>
  );
}

/** Corner panel with a left-edge resize handle; width persists. */
function FloatingPanel({ className, children }: { className?: string; children: React.ReactNode }) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : 420;
    } catch {
      return 420;
    }
  });
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startW: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.current.startW - (e.clientX - drag.current.startX)));
    setWidth(next);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl card-glass shadow-2xl",
        className,
      )}
      style={{ width }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-primary/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Drag to resize"
      />
      {children}
    </div>
  );
}

/** Pick which tile is the big one and which is the PiP for the floating panel. */
function useFloatingTiles(): { main: MediaTileModel | null; pip: MediaTileModel | null } {
  const tiles = useCallTiles();
  const swapped = useAppSelector((s) => s.call.swapped);
  const remoteShare = tiles.find((t) => !t.isLocal && t.source === "screenshare") ?? null;
  const remoteCam = tiles.find((t) => !t.isLocal && t.source === "camera") ?? null;
  const localCam = tiles.find((t) => t.isLocal && t.source === "camera") ?? null;
  const remote = remoteShare ?? remoteCam;
  if (!remote) return { main: localCam && swapped ? localCam : null, pip: localCam };
  return swapped ? { main: localCam, pip: remote } : { main: remote, pip: localCam };
}

function FloatingCallStage({
  partnerName,
  partnerPicture,
  statusText,
  onExpand,
}: {
  partnerName: string;
  partnerPicture?: string | null;
  statusText: string | null;
  onExpand: () => void;
}) {
  const { main, pip } = useFloatingTiles();
  const isVideo = useAppSelector((s) => s.call.activeCall?.callType === "video");

  return (
    <div className={cn("relative w-full bg-black", isVideo || main?.hasVideo ? "aspect-video" : "aspect-[16/7]")}>
      {main ? (
        <MediaTile
          tile={main}
          fit="cover"
          onFocus={onExpand}
          extras={!main.isLocal && main.source === "camera" ? <TileVolumeControl pubkey={main.pubkey} /> : null}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card">
          <Avatar src={partnerPicture} alt={partnerName} size="lg" className="h-16 w-16" />
          <div className="text-sm font-medium text-heading">{partnerName}</div>
        </div>
      )}

      {statusText && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/90 backdrop-blur-sm">
            <Loader2 size={12} className="animate-spin" />
            {statusText}
          </span>
        </div>
      )}

      {pip && <CallPip tile={pip} />}
    </div>
  );
}

const CORNER_CLASS: Record<PipCorner, string> = {
  tl: "left-3 top-3",
  tr: "right-3 top-3",
  bl: "bottom-3 left-3",
  br: "bottom-3 right-3",
};

/** Draggable picture-in-picture that snaps to a corner; click swaps tiles. */
function CallPip({ tile }: { tile: MediaTileModel }) {
  const dispatch = useAppDispatch();
  const corner = useAppSelector((s) => s.call.pipCorner);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
    ref.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.current.moved = true;
    if (drag.current.moved) setOffset({ x: dx, y: dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setOffset(null);
    if (!d) return;
    if (!d.moved) {
      dispatch(swapCallTiles());
      return;
    }
    const parent = ref.current?.parentElement;
    const self = ref.current;
    if (!parent || !self) return;
    const pr = parent.getBoundingClientRect();
    const sr = self.getBoundingClientRect();
    const cx = sr.left + sr.width / 2 - pr.left;
    const cy = sr.top + sr.height / 2 - pr.top;
    dispatch(setPipCorner(nearestCorner(cx, cy, pr.width, pr.height)));
    void e;
  };

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-10 w-36 cursor-grab touch-none select-none overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 aspect-video active:cursor-grabbing",
        CORNER_CLASS[corner],
        offset ? "" : "transition-[left,right,top,bottom] duration-200",
      )}
      style={offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title="Drag to move · click to swap"
    >
      <MediaTile tile={tile} fit="cover" compact />
    </div>
  );
}

/** Full MediaStage for the expanded overlay (voice.layout drives it). */
function ExpandedCallStage({
  partnerName,
  partnerPicture,
  statusText,
}: {
  partnerName: string;
  partnerPicture?: string | null;
  statusText: string | null;
}) {
  const dispatch = useAppDispatch();
  const tiles = useCallTiles();
  const layout = useAppSelector((s) => s.voice.layout);
  const activeSpeakers = useAppSelector((s) => s.voice.activeSpeakers);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isScreenSharing = useAppSelector((s) => s.call.activeCall?.isScreenSharing ?? false);

  const onStopLocalShare = useCallback(async () => {
    if (!isScreenSharing) return;
    dispatch(toggleCallScreenShare());
    try {
      await setCallScreenShare(false);
    } catch {
      dispatch(toggleCallScreenShare());
    }
  }, [isScreenSharing, dispatch]);

  const renderTileExtras = useCallback(
    (tile: MediaTileModel) =>
      !tile.isLocal && tile.source === "camera" ? <TileVolumeControl pubkey={tile.pubkey} /> : null,
    [],
  );

  const hasRemote = tiles.some((t) => !t.isLocal);

  return (
    <div className="relative h-full w-full">
      <MediaStage
        tiles={tiles}
        layout={layout}
        activeSpeakers={activeSpeakers}
        localPubkey={myPubkey}
        onFocusTile={(id) => dispatch(focusTile(id))}
        onPinTile={(id) => dispatch(pinTile(id))}
        onSetLayoutMode={(mode) => dispatch(setLayoutMode(mode))}
        onToggleAutoFocusSpeaker={() => dispatch(toggleAutoFocusSpeaker())}
        onSetFit={(id, fit: TileFit) => dispatch(setTileFit({ id, fit }))}
        onStopLocalShare={() => void onStopLocalShare()}
        renderTileExtras={renderTileExtras}
        hideToolbar={tiles.length <= 2}
      />
      {!hasRemote && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
          <Avatar src={partnerPicture} alt={partnerName} size="lg" className="h-24 w-24" />
          <div className="text-lg font-semibold text-white">{partnerName}</div>
          {statusText && (
            <div className="flex items-center gap-2 text-sm text-white/70">
              <Loader2 size={16} className="animate-spin" />
              {statusText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Live call timer display */
function CallTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span>
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
}
