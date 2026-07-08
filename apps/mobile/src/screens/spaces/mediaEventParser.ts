// Media-channel event parsing: kinds 20 (picture, NIP-68), 21/22 (video,
// NIP-71) and 34235/34236 (addressable video) → grid tiles. Pure + tested;
// URL sanitizing happens here so tiles never see javascript:/data: schemes.

import type { NostrEvent } from "@thewired/shared-types";

export interface MediaItem {
  id: string;
  event: NostrEvent;
  type: "image" | "video";
  /** https URL of the image or the video file. */
  src: string;
  /** Optional https poster/thumbnail for video tiles. */
  poster?: string;
}

const IMAGE_KINDS = new Set([20]);
const VIDEO_KINDS = new Set([21, 22, 34235, 34236]);

function httpsUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^https:\/\/[^\s]+$/i.test(trimmed) ? trimmed : undefined;
}

interface ImetaFields {
  url?: string;
  image?: string;
  thumb?: string;
}

/** Space-delimited key/value entries inside each ["imeta", ...] tag. */
function parseImeta(event: NostrEvent): ImetaFields[] {
  const out: ImetaFields[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const fields: ImetaFields = {};
    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      if (typeof entry !== "string") continue;
      const spaceIdx = entry.indexOf(" ");
      if (spaceIdx === -1) continue;
      const key = entry.slice(0, spaceIdx);
      const value = entry.slice(spaceIdx + 1);
      if (key === "url") fields.url = value;
      else if (key === "image") fields.image = value;
      else if (key === "thumb") fields.thumb = value;
    }
    if (fields.url || fields.image) out.push(fields);
  }
  return out;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

export function parseMediaEvent(event: NostrEvent): MediaItem | null {
  const imeta = parseImeta(event);

  if (IMAGE_KINDS.has(event.kind)) {
    const src = httpsUrl(imeta[0]?.url) ?? httpsUrl(tagValue(event, "url"));
    if (!src) return null;
    return { id: event.id, event, type: "image", src };
  }

  if (VIDEO_KINDS.has(event.kind)) {
    const src = httpsUrl(imeta[0]?.url) ?? httpsUrl(tagValue(event, "url"));
    if (!src) return null;
    const poster =
      httpsUrl(imeta[0]?.image) ??
      httpsUrl(imeta[0]?.thumb) ??
      httpsUrl(tagValue(event, "thumb")) ??
      httpsUrl(tagValue(event, "image"));
    return { id: event.id, event, type: "video", src, poster };
  }

  return null;
}

export function parseMediaEvents(events: NostrEvent[]): MediaItem[] {
  const out: MediaItem[] = [];
  for (const event of events) {
    const item = parseMediaEvent(event);
    if (item) out.push(item);
  }
  return out;
}
