import { useRef, useMemo, useState, useCallback } from "react";
import { RichContent } from "@/components/content/RichContent";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useAppSelector } from "@/store/hooks";
import { matchEmbed } from "@/lib/content/embedPatterns";
import { DMMessageContextMenu } from "./DMMessageContextMenu";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";

const URL_RE = /https?:\/\/\S+/;

interface DMMessageProps {
  message: DMMessageType;
  partnerPubkey: string;
}

export function DMMessage({ message, partnerPubkey }: DMMessageProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = message.senderPubkey === myPubkey;
  const { profile } = useProfile(message.senderPubkey);
  const { openUserPopover } = useUserPopover();
  const timeAgo = useRelativeTime(message.createdAt, true);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const hasEmbed = useMemo(() => {
    const urlMatch = message.content.match(URL_RE);
    return urlMatch ? !!matchEmbed(urlMatch[0]) : false;
  }, [message.content]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div
      className={`flex gap-3 px-4 py-2 ${isMe ? "flex-row-reverse" : ""}`}
      onContextMenu={handleContextMenu}
    >
      {!isMe && (
        <button
          ref={avatarRef}
          type="button"
          onClick={() => {
            if (avatarRef.current) openUserPopover(message.senderPubkey, avatarRef.current);
          }}
          className="cursor-pointer shrink-0 mt-0.5"
        >
          <Avatar src={profile?.picture} alt="" size="sm" />
        </button>
      )}
      <div className={`${hasEmbed ? "max-w-[85%]" : "max-w-[70%]"} ${isMe ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2 text-sm ${
            isMe
              ? "bg-pulse-dim text-heading rounded-br-sm border border-pulse/15"
              : "bg-card text-body rounded-bl-sm border border-edge"
          }`}
        >
          <RichContent content={message.content} />
        </div>
        <div
          className={`mt-0.5 text-[10px] text-faint ${isMe ? "text-right" : "text-left"}`}
        >
          {timeAgo}
        </div>
      </div>
      <DMMessageContextMenu
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
        position={ctxMenu ?? { x: 0, y: 0 }}
        partnerPubkey={partnerPubkey}
        wrapId={message.wrapId}
        content={message.content}
      />
    </div>
  );
}
