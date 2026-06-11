import { memo, useCallback, useState } from "react";
import { useAppSelector } from "../../../store/hooks";
import { selectActiveSpace } from "../spaceSelectors";
import { useNoteEngagement } from "../useNoteEngagement";
import { useNoteActions } from "../useNoteActions";
import { useAskAI } from "@/features/ai/context/useAskAI";
import { buildThreadContext, buildNoteContext } from "@/features/ai/context/aiContext";
import { selectFeatureEnabled, FEATURE_AI } from "@/store/slices/featuresSlice";
import { useZap } from "../../wallet/WalletProvider";
import { NoteActionBar } from "./NoteActionBar";
import { ReplyComposer } from "./ReplyComposer";
import { ThreadView } from "./ThreadView";
import { NoteShareMenu } from "../../../components/sharing/NoteShareMenu";
import type { NostrEvent } from "../../../types/nostr";

/**
 * The interactive tail of a note card: engagement counts, action bar, reply
 * composer, thread, and share menu. Owns the `useNoteEngagement` subscription
 * (kinds 7/6/1) and all interaction state so an engagement event-storm — or a
 * reply/thread/share toggle — re-renders only this small subtree, never the
 * card's text or (memoized) media above it.
 */
export const NoteFooter = memo(function NoteFooter({ event }: { event: NostrEvent }) {
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [shareAnchor, setShareAnchor] = useState<HTMLElement | null>(null);

  const engagement = useNoteEngagement(event.id);
  const actions = useNoteActions(event);
  const activeSpace = useAppSelector(selectActiveSpace);
  const askAI = useAskAI();
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));
  const { openZap } = useZap();

  const handleReply = useCallback(() => setShowReplyComposer((v) => !v), []);
  // For now, Quote toggles the reply composer — future: dedicated quote modal.
  const handleQuote = useCallback(() => setShowReplyComposer((v) => !v), []);
  const handleRepost = useCallback(() => actions.repost(), [actions]);
  const handleLike = useCallback(() => actions.like(), [actions]);
  const handleSendReply = useCallback(
    (content: string) => {
      actions.reply(content);
      setShowReplyComposer(false);
    },
    [actions],
  );
  const handleCancelReply = useCallback(() => setShowReplyComposer(false), []);
  const handleToggleThread = useCallback(() => setThreadExpanded((v) => !v), []);
  const closeShare = useCallback(() => setShareAnchor(null), []);
  const handleZap = useCallback(
    () => openZap({ recipientPubkey: event.pubkey, event }),
    [openZap, event],
  );
  const handleAskAI = useCallback(
    () => askAI(buildThreadContext(event.id) ?? buildNoteContext(event.id)),
    [askAI, event.id],
  );

  return (
    <>
      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={handleReply}
        onRepost={handleRepost}
        onLike={handleLike}
        onQuote={handleQuote}
        onShare={setShareAnchor}
        onZap={handleZap}
        onAskAI={aiEnabled ? handleAskAI : undefined}
      />

      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={handleSendReply}
          onCancel={handleCancelReply}
        />
      )}

      {engagement.replyCount > 0 && (
        <ThreadView
          eventId={event.id}
          expanded={threadExpanded}
          onToggle={handleToggleThread}
        />
      )}

      <NoteShareMenu
        event={event}
        anchorEl={shareAnchor}
        onClose={closeShare}
        relays={activeSpace?.hostRelay ? [activeSpace.hostRelay] : undefined}
      />
    </>
  );
});
