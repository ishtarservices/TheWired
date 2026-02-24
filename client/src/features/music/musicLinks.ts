const KIND_TO_TYPE: Record<string, string> = {
  "33123": "album",
  "31683": "track",
};

/**
 * Build a shareable URL for a music addressable ID.
 * @param addressableId e.g. "33123:pubkey:slug" or "31683:pubkey:slug"
 */
export function buildMusicLink(addressableId: string): string {
  const [kind, pubkey, ...slugParts] = addressableId.split(":");
  const slug = slugParts.join(":");
  const type = KIND_TO_TYPE[kind] ?? "track";
  return `${window.location.origin}/music/${type}/${pubkey}/${slug}`;
}
