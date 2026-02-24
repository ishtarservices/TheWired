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
