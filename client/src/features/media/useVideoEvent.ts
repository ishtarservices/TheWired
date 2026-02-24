import { useMemo } from "react";
import type { NostrEvent } from "../../types/nostr";
import { parseVideoEvent, selectVideoSource } from "./imetaParser";

export function useVideoEvent(event: NostrEvent | null) {
  return useMemo(() => {
    if (!event) return { video: null, sourceUrl: null };

    const video = parseVideoEvent(event);
    const sourceUrl = selectVideoSource(video.variants);
    return { video, sourceUrl };
  }, [event]);
}
