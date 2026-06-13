/** Parsed imeta tag data */
export interface ImetaVariant {
  url: string;
  mimeType: string;
  hash?: string;
  size?: number;
  dim?: string;
  bitrate?: number;
  duration?: number;
  fallback?: string;
  blurhash?: string;
}

/** Video event display data */
export interface VideoEvent {
  eventId: string;
  pubkey: string;
  title?: string;
  summary?: string;
  thumbnail?: string;
  duration?: number;
  variants: ImetaVariant[];
  createdAt: number;
}

/** Long-form article display data */
export interface LongFormArticle {
  eventId: string;
  pubkey: string;
  dTag: string;
  title: string;
  summary?: string;
  image?: string;
  publishedAt?: number;
  content: string;
  hashtags: string[];
}

/** Where an article is published (soft "space-exclusive" mirrors music). */
export type ArticleVisibility = "public" | "space";

/**
 * A device-local, in-progress article draft (everything the editor needs to
 * restore a session). Persisted in IndexedDB, per-account — NOT synced to any
 * relay and never a kind:30024. `tags` is the raw comma-separated string as
 * typed in the editor. Timestamps are unix milliseconds.
 */
export interface ArticleDraftRecord {
  /** Stable local id (nanoid). Distinct from any published d-tag. */
  id: string;
  title: string;
  summary: string;
  image: string;
  tags: string;
  content: string;
  visibility: ArticleVisibility;
  spaceId: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
}

/** The mutable editor fields — a draft record minus identity + timestamps. */
export type ArticleDraftFields = Omit<
  ArticleDraftRecord,
  "id" | "createdAt" | "updatedAt"
>;
