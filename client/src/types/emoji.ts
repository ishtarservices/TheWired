/** NIP-30 custom emoji reference */
export interface CustomEmoji {
  shortcode: string;
  url: string;
  /** Optional emoji set address: "30030:pubkey:d-tag" */
  setAddress?: string;
}

/** NIP-30 kind:30030 emoji set */
export interface EmojiSet {
  /** Addressable ID: "30030:pubkey:d-tag" */
  addressableId: string;
  pubkey: string;
  dTag: string;
  title?: string;
  image?: string;
  description?: string;
  emojis: CustomEmoji[];
  createdAt: number;
  eventId: string;
}

/** GIF item from search results */
export interface GifItem {
  id: string;
  title: string;
  /** Full-size GIF URL */
  url: string;
  /** Thumbnail for grid preview */
  previewUrl: string;
  width: number;
  height: number;
}
