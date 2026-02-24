/** Music upload response DTO */
export interface MusicUploadResponse {
  url: string;
  sha256: string;
  size: number;
  mimeType: string;
  duration?: number;
}

/** Music search result DTO */
export interface MusicSearchResult {
  id: string;
  type: "track" | "album" | "artist";
  title?: string;
  artist?: string;
  pubkey: string;
  imageUrl?: string;
  addressableId?: string;
}
