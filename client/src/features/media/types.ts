import type { TileSource, TileFit, VoiceLayoutState } from "@/types/calling";

/** One tile on the stage: a participant's camera or screen share. */
export interface MediaTileModel {
  /** `${pubkey}:${source}` */
  id: string;
  pubkey: string;
  source: TileSource;
  isLocal: boolean;
  /** Fallback label; the tile resolves the profile name itself. */
  displayName: string;
  isSpeaking: boolean;
  isMuted: boolean;
  /** Camera tiles: camera on. Screen-share tiles: always true. */
  hasVideo: boolean;
  handRaised: boolean;
  connectionQuality: "excellent" | "good" | "poor" | "unknown";
}

export const tileId = (pubkey: string, source: TileSource): string => `${pubkey}:${source}`;

export type { TileSource, TileFit, VoiceLayoutState };
