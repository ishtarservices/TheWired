import { useContext, useMemo, type ReactNode } from "react";
import { useNavigation } from "@react-navigation/native";
import { Linking, View } from "react-native";
import { nip19 } from "nostr-tools";

import { Type } from "@/components/ui/Type";
import { cn } from "@/lib/cn";
import { parseContent } from "@/lib/nostr/parseContent";
import { openThread } from "@/navigation/openThread";
import type { TypeRole } from "@/theme/typography";
import { EmbedDepthContext, MAX_EMBED_DEPTH } from "./embedDepth";
import { EmbeddedNoteCard } from "./EmbeddedNoteCard";
import { MentionText } from "./MentionText";
import type { EmbedRef } from "./useEmbeddedEvent";

// The one shared rich-text chokepoint (desktop RichContent, RN-shaped) —
// NoteCard bodies, space-chat rows, and DM bubbles all render through here.
// Inline runs (text, @mentions, #hashtags, tappable URLs) nest inside a
// single root <Type>; event/addr refs leave the text flow and render as
// compact embed cards BELOW it (RN can't nest Views in Text). Inside an
// embed (depth ≥ MAX_EMBED_DEPTH) refs stay inline as plain "↗ note" links
// and never fetch — the recursion guard.

const LONG_FORM_KIND = 30023;

export interface NoteTextProps {
  content: string;
  /** Type-scale role for every text run (default body). */
  role?: TypeRole;
  /** Clamp on the inline text root — block embeds are never clamped. */
  numberOfLines?: number;
  containerClassName?: string;
  /** Color/leading classes for text runs; inline mentions/links inherit it
   *  (nested Type resets color, so the tint must be passed, not cascaded). */
  textClassName?: string;
  /** Event ids already rendered by the surface (q-tag quote cards) — their
   *  inline refs are dropped instead of double-embedded. Desktop parity. */
  suppressEventIds?: string[];
}

export function NoteText({
  content,
  role = "body",
  numberOfLines,
  containerClassName,
  textClassName,
  suppressEventIds,
}: NoteTextProps) {
  const depth = useContext(EmbedDepthContext);
  const navigation = useNavigation();
  const segments = useMemo(() => parseContent(content), [content]);

  const openRef = (ref: EmbedRef) => {
    if (ref.type === "addr-ref" && ref.kind === LONG_FORM_KIND) {
      const naddr = nip19.naddrEncode({
        identifier: ref.identifier,
        pubkey: ref.pubkey,
        kind: ref.kind,
      });
      navigation.navigate("Article", { naddr });
    } else if (ref.type === "event-ref") {
      // No event in hand for a bare inline ref — the thread screen resolves
      // the conversation root itself.
      openThread(navigation, { noteId: ref.id });
    }
  };

  const openUrl = (url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    Linking.openURL(url).catch(() => {});
  };

  const inline: ReactNode[] = [];
  const blocks: EmbedRef[] = [];

  segments.forEach((seg, i) => {
    switch (seg.type) {
      case "text":
        inline.push(seg.text);
        break;
      case "hashtag":
        inline.push(`#${seg.value}`);
        break;
      case "mention":
        inline.push(
          <MentionText key={`m${i}`} pubkey={seg.pubkey} role={role} className={textClassName} />,
        );
        break;
      case "url":
      case "image":
        inline.push(
          <Type
            key={`u${i}`}
            role={role}
            className={cn(textClassName, "underline")}
            accessibilityRole="link"
            onPress={() => openUrl(seg.url)}
            suppressHighlighting
          >
            {seg.url}
          </Type>,
        );
        break;
      case "event-ref":
      case "addr-ref": {
        if (seg.type === "event-ref" && suppressEventIds?.includes(seg.id)) break;
        if (depth >= MAX_EMBED_DEPTH) {
          // Inside an embed: a plain tappable link, no card, no fetch.
          inline.push(
            <Type
              key={`r${i}`}
              role={role}
              weight={600}
              className={cn("text-heading", textClassName)}
              accessibilityRole="link"
              onPress={() => openRef(seg)}
              suppressHighlighting
            >
              {seg.type === "addr-ref" && seg.kind === LONG_FORM_KIND ? "↗ article" : "↗ note"}
            </Type>,
          );
        } else {
          blocks.push(seg);
        }
        break;
      }
    }
  });

  // Trim the seams a lifted-out ref leaves behind so a share that is just
  // "nostr:nevent1…" renders as the card alone, no empty text line.
  while (inline.length && typeof inline[0] === "string" && !inline[0].trim()) inline.shift();
  while (
    inline.length &&
    typeof inline[inline.length - 1] === "string" &&
    !(inline[inline.length - 1] as string).trim()
  ) {
    inline.pop();
  }
  if (typeof inline[0] === "string") inline[0] = (inline[0] as string).trimStart();
  if (typeof inline[inline.length - 1] === "string") {
    inline[inline.length - 1] = (inline[inline.length - 1] as string).trimEnd();
  }

  const hasInline = inline.some((node) => (typeof node === "string" ? node.trim() : true));

  if (!hasInline && blocks.length === 0) return null;

  return (
    <View className={containerClassName}>
      {hasInline ? (
        <Type role={role} className={textClassName} numberOfLines={numberOfLines}>
          {inline}
        </Type>
      ) : null}
      {blocks.map((ref, i) => (
        <EmbeddedNoteCard
          key={ref.type === "event-ref" ? `e${ref.id}` : `a${ref.kind}:${ref.pubkey}:${ref.identifier}:${i}`}
          refSegment={ref}
          renderPreview={(text) => (
            <NoteText
              content={text}
              numberOfLines={3}
              role="caption"
              containerClassName="mt-1"
              textClassName="leading-5 text-soft"
            />
          )}
        />
      ))}
    </View>
  );
}
