import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatReply } from "./ChatReply";
import { ChatInput } from "./ChatInput";
import { useChat } from "./useChat";
import { Spinner } from "../../components/ui/Spinner";
import { useAppSelector } from "../../store/hooks";
import { AlertCircle, RefreshCw } from "lucide-react";

export function ChatView() {
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const {
    messages,
    pendingMessages,
    replyTo,
    setReplyTo,
    sendMessage,
    retryMessage,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, pendingMessages.length]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 && pendingMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              No messages yet. Start the conversation!
            </p>
          </div>
        ) : (
          <>
            {messages.map((event) => (
              <ChatMessage
                key={event.id}
                event={event}
                onReply={
                  isLoggedIn
                    ? (eventId, pubkey) => setReplyTo({ eventId, pubkey })
                    : undefined
                }
              />
            ))}
            {pendingMessages.map((msg) => (
              <div
                key={msg.tempId}
                className="flex items-center gap-2 px-4 py-1.5 opacity-60"
              >
                <div className="min-w-0 flex-1 text-sm text-soft">
                  {msg.content}
                </div>
                {msg.status === "pending" && <Spinner size="sm" />}
                {msg.status === "failed" && (
                  <div className="flex items-center gap-1">
                    <AlertCircle size={14} className="text-red-400" />
                    <button
                      onClick={() => retryMessage(msg.tempId)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {replyTo && (
        <ChatReply pubkey={replyTo.pubkey} onCancel={() => setReplyTo(null)} />
      )}

      <ChatInput onSend={sendMessage} disabled={!isLoggedIn} />
    </div>
  );
}
