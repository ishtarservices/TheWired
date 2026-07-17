import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { Avatar } from "@/components/ui/Avatar";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { splitNoteContent } from "@/lib/nostr/noteContent";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { openThread } from "@/navigation/openThread";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";
import { EmbedDepthContext, MAX_EMBED_DEPTH } from "./embedDepth";
import { useEmbeddedEvent, type EmbedRef } from "./useEmbeddedEvent";

// Compact kind-aware embed card for a nostr:nevent/note/naddr reference —
// the desktop EmbeddedNote, reshaped for phone widths: hairline border,
// author line, 3-line preview, tap → NoteThread (or Article for 30023).
// States are explicit: skeleton while resolving, an "unavailable" hairline
// when the fetch comes back empty — never the raw bech32. Depth ≥ 1 renders
// as a plain link line and never fetches (embedDepth guard); this component
// is only mounted at depth 0 (NoteText inlines links at deeper levels).

const LONG_FORM_KIND = 30023;

function timeLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function cardFrame(borderColor: string) {
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor,
  };
}

// The card carries its own canvas-colored surface (bg-background) so its
// text tokens keep their designed contrast wherever it's hosted — on the
// canvas it's invisible, inside a primary-filled DM bubble it insets.

function EmbedSkeleton() {
  const { tokens } = useTheme();
  return (
    <View
      className="mt-2 rounded-xl bg-background px-3 py-2.5"
      style={cardFrame(tokens.borderLight)}
    >
      <View className="flex-row items-center gap-2">
        <SkeletonCircle size={20} />
        <Skeleton className="h-3 w-24" />
      </View>
      <Skeleton className="mt-2 h-3.5 w-4/5" />
    </View>
  );
}

function EmbedUnavailable() {
  const { tokens } = useTheme();
  return (
    <View
      className="mt-2 rounded-xl bg-background px-3 py-2.5"
      style={cardFrame(tokens.borderLight)}
    >
      <Type role="meta" className="text-muted">
        note unavailable
      </Type>
    </View>
  );
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

export interface EmbeddedNoteCardProps {
  refSegment: EmbedRef;
  /** Renders the preview text — NoteText injects itself here so this module
   *  never imports it back (avoids the NoteText ↔ card require cycle). */
  renderPreview: (text: string) => ReactNode;
}

export function EmbeddedNoteCard({ refSegment, renderPreview }: EmbeddedNoteCardProps) {
  const depth = useContext(EmbedDepthContext);
  const { tokens } = useTheme();
  const navigation = useNavigation();
  const engine = useEngine();
  const { event, loading, notFound } = useEmbeddedEvent(refSegment);

  const authorPubkey = event?.pubkey;
  const profile = useAppSelector((s) =>
    authorPubkey ? s.profiles.byPubkey[authorPubkey] : undefined,
  );
  useEffect(() => {
    if (authorPubkey) engine.requestProfiles([authorPubkey]);
  }, [engine, authorPubkey]);

  // Belt-and-braces: NoteText never mounts cards past the guard, but if a
  // future caller does, degrade to the link line rather than fetch.
  if (depth >= MAX_EMBED_DEPTH) return null;

  if (loading) return <EmbedSkeleton />;
  if (notFound || !event) return <EmbedUnavailable />;

  const name = profileDisplayName(profile, event.pubkey);
  const isArticle = event.kind === LONG_FORM_KIND;

  const open = () => {
    if (isArticle) {
      const naddr = nip19.naddrEncode({
        identifier: tagValue(event, "d") ?? "",
        pubkey: event.pubkey,
        kind: LONG_FORM_KIND,
      });
      navigation.navigate("Article", { naddr });
    } else {
      openThread(navigation, {
        noteId: event.id,
        rootId: parseThreadRef(event).rootId ?? event.id,
      });
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isArticle ? `Open article by ${name}` : `Open note by ${name}`}
      onPress={open}
      className="mt-2 rounded-xl bg-background px-3 py-2.5 active:bg-surface-hover"
      style={cardFrame(tokens.borderLight)}
    >
      <View className="flex-row items-center gap-2">
        <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={20} />
        <Type role="caption" weight={600} className="shrink text-heading" numberOfLines={1}>
          {name}
        </Type>
        <Type role="micro" tabular className="text-faint">
          {timeLabel(event.created_at)}
        </Type>
      </View>
      {isArticle ? (
        <ArticlePreview event={event} />
      ) : (
        <NotePreview event={event} renderPreview={renderPreview} />
      )}
    </Pressable>
  );
}

/** Kind-30023: title + summary from tags, never the markdown body. */
function ArticlePreview({ event }: { event: NostrEvent }) {
  const title = tagValue(event, "title")?.trim() || "Untitled";
  const summary = tagValue(event, "summary")?.trim();
  return (
    <View className="mt-1.5">
      <Type role="caption" weight={600} className="text-heading" numberOfLines={2}>
        {title}
      </Type>
      {summary ? (
        <Type role="caption" className="mt-0.5 text-muted" numberOfLines={2}>
          {summary}
        </Type>
      ) : null}
    </View>
  );
}

/** Default preview (kinds 1/9/…): 3 lines of text; nested refs render as
 *  plain links via the depth provider — no recursive cards or fetches. */
function NotePreview({
  event,
  renderPreview,
}: {
  event: NostrEvent;
  renderPreview: (text: string) => ReactNode;
}) {
  const depth = useContext(EmbedDepthContext);
  // Image URLs would read as noise in a 3-line preview — drop them.
  const text = useMemo(() => splitNoteContent(event.content).text, [event.content]);
  return (
    <EmbedDepthContext.Provider value={depth + 1}>
      {text ? (
        renderPreview(text)
      ) : (
        <Type role="meta" className="mt-1 text-muted">
          media post
        </Type>
      )}
    </EmbedDepthContext.Provider>
  );
}
