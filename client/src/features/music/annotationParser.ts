import type { NostrEvent } from "@/types/nostr";
import type { MusicAnnotation, AnnotationLabel } from "@/types/music";

const KNOWN_LABELS: AnnotationLabel[] = ["story", "credits", "thanks", "process", "lyrics"];

/** Parse a kind:31686 annotation event into display data */
export function parseAnnotationEvent(event: NostrEvent): MusicAnnotation | null {
  const targetRef = event.tags.find((t) => t[0] === "a")?.[1];
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  if (!targetRef || !event.content) return null;

  const labelTag = event.tags.find((t) => t[0] === "label")?.[1];
  const isPrivate = event.tags.some((t) => t[0] === "visibility" && t[1] === "private");
  const isPinned = event.tags.some((t) => t[0] === "pinned" && t[1] === "true");
  const spaceId = event.tags.find((t) => t[0] === "h")?.[1];

  const label: AnnotationLabel | undefined = labelTag
    ? (KNOWN_LABELS.includes(labelTag as AnnotationLabel) ? labelTag as AnnotationLabel : "custom")
    : undefined;

  return {
    addressableId: `31686:${event.pubkey}:${dTag}`,
    eventId: event.id,
    targetRef,
    authorPubkey: event.pubkey,
    content: event.content,
    label,
    customLabel: label === "custom" ? labelTag : undefined,
    isPrivate,
    isPinned,
    spaceId,
    createdAt: event.created_at,
  };
}
