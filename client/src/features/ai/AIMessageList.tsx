import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import {
  selectMessageIdsForConversation,
  selectIsStreaming,
  selectPendingWriteIdsForConversation,
} from "@/store/slices/aiSlice";
import { AIMessageBubble } from "./AIMessageBubble";
import { PendingWriteCard } from "./gate/PendingWriteCard";
import { isAtBottom, nextStick } from "./scrollFollow";

export function AIMessageList({ conversationId }: { conversationId: string }) {
  const messageIds = useAppSelector(selectMessageIdsForConversation(conversationId));
  const isStreaming = useAppSelector(selectIsStreaming(conversationId));
  const pendingWriteIds = useAppSelector(
    selectPendingWriteIdsForConversation(conversationId),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether we're auto-following the bottom. Released when the user scrolls up,
  // re-attached when they return to the bottom (or hit the jump button).
  const stick = useRef(true);
  // True while WE are scrolling, so the resulting scroll event doesn't get
  // mistaken for the user taking over (no feedback loop).
  const programmatic = useRef(false);
  const lastTop = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
    // The scroll event from the assignment is queued; clear the guard after it
    // (and before paint) so a genuine user scroll on the next frame is honored.
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (programmatic.current) {
      lastTop.current = top;
      return; // ignore our own scrolling (no feedback loop)
    }
    const m = {
      top,
      lastTop: lastTop.current,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
    stick.current = nextStick(stick.current, m);
    lastTop.current = top;
    setShowJump(!isAtBottom(m));
  };

  // Follow content growth while stuck. A ResizeObserver catches every height
  // change — streamed text, images loading, code blocks, expanded reasoning,
  // pending-write cards — not just message-count/length, so it never lags.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Switching conversations: re-attach to the bottom and jump there.
  useEffect(() => {
    stick.current = true;
    setShowJump(false);
    requestAnimationFrame(scrollToBottom);
  }, [conversationId]);

  const jumpToBottom = () => {
    stick.current = true;
    scrollToBottom();
    setShowJump(false);
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div ref={contentRef} className="mx-auto max-w-3xl py-4">
          {messageIds.map((id, i) => (
            <AIMessageBubble
              key={id}
              messageId={id}
              conversationId={conversationId}
              isLast={i === messageIds.length - 1}
            />
          ))}
          {pendingWriteIds.map((id) => (
            <PendingWriteCard key={id} id={id} />
          ))}
        </div>
      </div>

      {showJump && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-surface text-heading shadow-lg ring-1 ring-border transition-colors hover:bg-surface-hover"
          title="Scroll to bottom"
          aria-label="Scroll to latest"
        >
          <ArrowDown size={16} />
        </button>
      )}

      {/* Screen-reader status: announce start/finish, never per token. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {isStreaming ? "Generating response…" : messageIds.length > 0 ? "Response complete" : ""}
      </div>
    </div>
  );
}
