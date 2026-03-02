import { useRef } from "react";
import { RichContent } from "@/components/content/RichContent";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useAppSelector } from "@/store/hooks";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";

interface DMMessageProps {
  message: DMMessageType;
}

export function DMMessage({ message }: DMMessageProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = message.senderPubkey === myPubkey;
  const { profile } = useProfile(message.senderPubkey);
  const { openUserPopover } = useUserPopover();
  const timeAgo = useRelativeTime(message.createdAt, true);
  const avatarRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`flex gap-3 px-4 py-2 ${isMe ? "flex-row-reverse" : ""}`}>
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
      <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2 text-sm ${
            isMe
              ? "bg-pulse/20 text-heading rounded-br-sm"
              : "bg-white/6 text-body rounded-bl-sm"
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
    </div>
  );
}
