import { useEffect, useRef, type RefObject } from "react";

interface StickToBottomOptions {
  /** Observe only while there is content (the wrapper is mounted). */
  active?: boolean;
  /** Distance from the bottom (px) that still counts as "at the bottom". */
  threshold?: number;
  /**
   * A near-bottom flag the view already keeps up to date on scroll. When
   * given, the hook reads it instead of listening to scroll itself.
   */
  nearBottomRef?: RefObject<boolean>;
}

/**
 * Keep a chat pinned to its newest message while its content changes height
 * after render: an image or video arriving, a shared post resolving, an embed
 * loading. Only while the reader is at the bottom; history they scrolled up
 * to is left where it is.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  { active = true, threshold = 80, nearBottomRef }: StickToBottomOptions = {},
): void {
  const ownNearBottom = useRef(true);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!active || !scroller || !content || typeof ResizeObserver === "undefined") return;

    const flag = nearBottomRef ?? ownNearBottom;
    const onScroll = () => {
      ownNearBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < threshold;
    };
    if (!nearBottomRef) {
      onScroll();
      scroller.addEventListener("scroll", onScroll, { passive: true });
    }

    let lastHeight = content.offsetHeight;
    const observer = new ResizeObserver(() => {
      const height = content.offsetHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      if (flag.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
      if (!nearBottomRef) scroller.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, contentRef, active, threshold, nearBottomRef]);
}
