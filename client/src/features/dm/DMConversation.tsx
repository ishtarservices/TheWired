import { useEffect, useRef, useCallback } from "react";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { DMMessage } from "./DMMessage";
import { DMInput } from "./DMInput";
import { useDMConversation } from "./useDMConversation";
import { sendDM } from "./dmService";
import { useAppDispatch } from "@/store/hooks";
import { markConversationRead } from "@/store/slices/dmSlice";
import { markDMNotificationsRead } from "@/store/slices/notificationSlice";
import { ArrowLeft } from "lucide-react";

interface DMConversationProps {
  partnerPubkey: string;
  onBack: () => void;
}

export function DMConversation({ partnerPubkey, onBack }: DMConversationProps) {
  const dispatch = useAppDispatch();
  const messages = useDMConversation(partnerPubkey);
  const { profile } = useProfile(partnerPubkey);
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayName =
    profile?.display_name || profile?.name || partnerPubkey.slice(0, 8) + "...";

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Mark as read — sync both DM unread count and notification bell
  useEffect(() => {
    dispatch(markConversationRead(partnerPubkey));
    dispatch(markDMNotificationsRead(partnerPubkey));
  }, [partnerPubkey, dispatch]);

  const handleSend = useCallback(
    async (content: string) => {
      try {
        await sendDM(partnerPubkey, content);
      } catch (err) {
        console.error("Failed to send DM:", err);
      }
    },
    [partnerPubkey],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1 text-muted hover:text-heading hover:bg-white/[0.04] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar src={profile?.picture} alt={displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-heading truncate">
            {displayName}
          </div>
          {profile?.nip05 && (
            <div className="text-xs text-muted truncate">{profile.nip05}</div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted">No messages yet</p>
              <p className="mt-1 text-xs text-faint">
                Messages are end-to-end encrypted
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => <DMMessage key={msg.wrapId} message={msg} />)
        )}
      </div>

      {/* Input */}
      <DMInput onSend={handleSend} />
    </div>
  );
}
