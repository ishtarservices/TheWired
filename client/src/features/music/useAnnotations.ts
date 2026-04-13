import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { buildAnnotationFilter } from "@/lib/nostr/filterBuilder";
import type { MusicAnnotation } from "@/types/music";

/**
 * Subscribe for kind:31686 annotations on a target track/album.
 * Events flow through processIncomingEvent → dedup → verify → Redux dispatch.
 * Returns visible annotations (private filtered to author-only).
 */
const EMPTY_ANNOTATIONS: MusicAnnotation[] = [];

export function useAnnotations(
  targetRef: string,
  opts?: { spaceId?: string },
) {
  const [loading, setLoading] = useState(true);

  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const allAnnotations = useAppSelector(
    (s) => s.music.annotations[targetRef] ?? EMPTY_ANNOTATIONS,
  );

  useEffect(() => {
    if (!targetRef) return;
    setLoading(true);

    const subId = subscriptionManager.subscribe({
      filters: [buildAnnotationFilter(targetRef)],
      onEOSE: () => setLoading(false),
    });

    // Fallback timeout — if EOSE never arrives (slow/offline relays),
    // stop showing the spinner after 5 seconds
    const timeout = setTimeout(() => setLoading(false), 5000);

    return () => {
      clearTimeout(timeout);
      subscriptionManager.close(subId);
    };
  }, [targetRef]);

  // Filter: private annotations only visible to their author
  let visible: MusicAnnotation[] = allAnnotations.filter(
    (a) => !a.isPrivate || a.authorPubkey === pubkey,
  );

  // Filter by space if specified
  if (opts?.spaceId) {
    visible = visible.filter(
      (a) => !a.spaceId || a.spaceId === opts.spaceId,
    );
  }

  return { annotations: visible, loading };
}
