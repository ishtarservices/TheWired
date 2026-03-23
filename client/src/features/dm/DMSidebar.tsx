import { useState, useCallback, memo } from "react";
import { MessageCircle, Users, X, SquarePen } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useDMContacts } from "./useDMContacts";
import { useFriends } from "./useFriends";
import { useAppSelector } from "@/store/hooks";
import { selectPendingIncomingRequests } from "./dmSelectors";
import { acceptFriendRequestAction, declineFriendRequestAction } from "@/lib/nostr/friendRequest";
import { DMConversationContextMenu } from "./DMConversationContextMenu";
import { NewDMModal } from "./NewDMModal";
import { getDisplayName } from "./dmUtils";
import type { DMContact } from "@/store/slices/dmSlice";

type SidebarTab = "messages" | "friends";

interface DMSidebarProps {
  activePartner: string | null;
  onSelectContact: (pubkey: string) => void;
}

export function DMSidebar({ activePartner, onSelectContact }: DMSidebarProps) {
  const contacts = useDMContacts();
  const friends = useFriends();
  const [activeTab, setActiveTab] = useState<SidebarTab>("messages");
  const pendingIncoming = useAppSelector(selectPendingIncomingRequests);

  const [showNewDM, setShowNewDM] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ pubkey: string; x: number; y: number } | null>(null);

  const handleContactContextMenu = useCallback(
    (pubkey: string, e: React.MouseEvent) => {
      e.preventDefault();
      setCtxMenu({ pubkey, x: e.clientX, y: e.clientY });
    },
    [],
  );

  return (
    <div className="flex flex-col border-r border-edge w-72">
      {/* Tab bar */}
      <div className="flex items-center border-b border-edge">
        <button
          onClick={() => setActiveTab("messages")}
          className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            activeTab === "messages"
              ? "border-b-2 border-pulse text-pulse"
              : "text-soft hover:text-heading"
          }`}
        >
          <MessageCircle size={13} />
          Messages
        </button>
        <button
          onClick={() => setActiveTab("friends")}
          className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            activeTab === "friends"
              ? "border-b-2 border-pulse text-pulse"
              : "text-soft hover:text-heading"
          }`}
        >
          <Users size={13} />
          Friends
          {friends.length > 0 && (
            <span className="ml-0.5 text-[10px] text-muted">
              {friends.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowNewDM(true)}
          className="mr-2 rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          title="New message"
        >
          <SquarePen size={15} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "messages" ? (
          contacts.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted">
              No conversations yet
            </div>
          ) : (
            <>
              {contacts.map((contact) => (
                <DMContactItem
                  key={contact.pubkey}
                  contact={contact}
                  isActive={activePartner === contact.pubkey}
                  onClick={() => onSelectContact(contact.pubkey)}
                  onContextMenu={(e) => handleContactContextMenu(contact.pubkey, e)}
                />
              ))}
              <DMConversationContextMenu
                open={!!ctxMenu}
                onClose={() => setCtxMenu(null)}
                position={ctxMenu ?? { x: 0, y: 0 }}
                partnerPubkey={ctxMenu?.pubkey ?? ""}
              />
            </>
          )
        ) : (
          <>
            {/* Pending friend requests */}
            {pendingIncoming.length > 0 && (
              <div className="border-b border-edge">
                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Pending Requests
                  </span>
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-pulse px-1 text-[10px] font-bold text-white">
                    {pendingIncoming.length}
                  </span>
                </div>
                {pendingIncoming.map((req) => (
                  <PendingRequestItem key={req.id} request={req} />
                ))}
              </div>
            )}

            {/* Friends list */}
            {friends.length === 0 && pendingIncoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <Users size={28} className="mb-2 text-muted opacity-30" />
                <p className="text-xs font-medium text-muted">
                  No friends yet
                </p>
                <p className="mt-1 text-[11px] text-faint">
                  Send friend requests from profiles to add friends
                </p>
              </div>
            ) : (
              friends.map((pk) => (
                <FriendItem
                  key={pk}
                  pubkey={pk}
                  isActive={activePartner === pk}
                  onClick={() => onSelectContact(pk)}
                />
              ))
            )}
          </>
        )}
      </div>

      <NewDMModal
        open={showNewDM}
        onClose={() => setShowNewDM(false)}
        onSelect={onSelectContact}
      />
    </div>
  );
}

const DMContactItem = memo(function DMContactItem({
  contact,
  isActive,
  onClick,
  onContextMenu,
}: {
  contact: DMContact;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { profile } = useProfile(contact.pubkey);
  const displayName = getDisplayName(profile, contact.pubkey);
  const timeAgo = useRelativeTime(contact.lastMessageAt);

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isActive ? "bg-surface-hover" : "hover:bg-surface"
      }`}
    >
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-heading truncate">
            {displayName}
          </span>
          <span className="text-[10px] text-faint shrink-0 ml-2">
            {timeAgo}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted truncate">
            {contact.lastMessagePreview}
          </span>
          {contact.unreadCount > 0 && (
            <span className="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-pulse px-1 text-[10px] font-bold text-white">
              {contact.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

const FriendItem = memo(function FriendItem({
  pubkey,
  isActive,
  onClick,
}: {
  pubkey: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const displayName = getDisplayName(profile, pubkey);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isActive ? "bg-surface-hover" : "hover:bg-surface"
      }`}
    >
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-heading truncate block">
          {displayName}
        </span>
        {profile?.nip05 && (
          <span className="text-[11px] text-muted truncate block">
            {profile.nip05}
          </span>
        )}
      </div>
      <MessageCircle size={14} className="shrink-0 text-muted" />
    </button>
  );
});

const PendingRequestItem = memo(function PendingRequestItem({
  request,
}: {
  request: { id: string; pubkey: string; message: string };
}) {
  const { profile } = useProfile(request.pubkey);
  const displayName = getDisplayName(profile, request.pubkey);

  return (
    <div className="flex w-full items-center gap-3 px-4 py-2.5">
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-heading truncate block">
          {displayName}
        </span>
        {request.message && (
          <span className="text-[11px] text-muted truncate block">
            {request.message}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => acceptFriendRequestAction(request.pubkey)}
          className="rounded-md bg-pulse/20 px-2 py-1 text-[10px] font-semibold text-pulse hover:bg-pulse/30 transition-colors"
        >
          Accept
        </button>
        <button
          onClick={() => declineFriendRequestAction(request.pubkey)}
          className="rounded-md p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          title="Decline"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
});
