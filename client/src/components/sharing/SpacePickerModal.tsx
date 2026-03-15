import { useState } from "react";
import { X, Search, Users, Share, ChevronLeft, Music, MessageSquare, FileText, Image, Hash } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import type { Space, SpaceChannel, SpaceChannelType } from "@/types/space";

interface SpacePickerModalProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onSelect: (space: Space, channel: SpaceChannel) => void | Promise<void>;
  title?: string;
  /** Only show channels of these types. Shows all non-admin channels if omitted. */
  channelTypes?: SpaceChannelType[];
}

function getChannelIcon(type: SpaceChannelType) {
  switch (type) {
    case "music": return <Music size={14} />;
    case "chat": return <MessageSquare size={14} />;
    case "articles": return <FileText size={14} />;
    case "media": return <Image size={14} />;
    default: return <Hash size={14} />;
  }
}

function SpaceRow({
  space,
  onSelect,
}: {
  space: Space;
  onSelect: (space: Space) => void;
}) {
  return (
    <button
      onClick={() => onSelect(space)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface"
    >
      {space.picture ? (
        <img
          src={space.picture}
          alt={space.name}
          className="h-8 w-8 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card">
          <Users size={14} className="text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-heading">{space.name}</p>
        <p className="truncate text-xs text-muted">
          {space.memberPubkeys.length} member{space.memberPubkeys.length !== 1 ? "s" : ""}
        </p>
      </div>
      <Share size={14} className="shrink-0 text-muted" />
    </button>
  );
}

function ChannelRow({
  channel,
  onSelect,
}: {
  channel: SpaceChannel;
  onSelect: (channel: SpaceChannel) => void;
}) {
  return (
    <button
      onClick={() => onSelect(channel)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-muted">
        {getChannelIcon(channel.type)}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-heading">{channel.label}</p>
        <p className="truncate text-xs text-muted">{channel.type}</p>
      </div>
    </button>
  );
}

export function SpacePickerModal({
  open,
  onClose,
  onBack,
  onSelect,
  title = "Share to Space",
  channelTypes,
}: SpacePickerModalProps) {
  const spaces = useAppSelector((s) => s.spaces.list);
  const allChannels = useAppSelector((s) => s.spaces.channels);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [searchQuery, setSearchQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);

  // Only show read-write spaces the user can post to
  const writableSpaces = spaces.filter((s) => s.mode === "read-write");

  const filtered = searchQuery.trim()
    ? writableSpaces.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : writableSpaces;

  // Channels for the selected space, filtered by type and admin permissions
  const availableChannels = selectedSpace
    ? (allChannels[selectedSpace.id] ?? []).filter((ch) => {
        if (channelTypes && !channelTypes.includes(ch.type)) return false;
        if (ch.adminOnly && !selectedSpace.adminPubkeys.includes(pubkey ?? "")) return false;
        return true;
      })
    : [];

  const handleSpaceClick = (space: Space) => {
    setSelectedSpace(space);
    setSearchQuery("");
  };

  const handleChannelSelect = async (channel: SpaceChannel) => {
    if (sending || !selectedSpace) return;
    setSending(true);
    try {
      await onSelect(selectedSpace, channel);
      onClose();
    } catch {
      // Let caller handle errors
    } finally {
      setSending(false);
      setSelectedSpace(null);
    }
  };

  const handleClose = () => {
    setSelectedSpace(null);
    setSearchQuery("");
    onClose();
  };

  const handleBack = () => {
    setSelectedSpace(null);
    setSearchQuery("");
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-sm rounded-2xl border border-edge card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          {selectedSpace ? (
            <div className="flex items-center gap-2">
              <button onClick={handleBack} className="text-soft hover:text-heading">
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-semibold text-heading">
                {selectedSpace.name}
              </h2>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {onBack && (
                <button onClick={onBack} className="text-soft hover:text-heading">
                  <ChevronLeft size={18} />
                </button>
              )}
              <h2 className="text-lg font-semibold text-heading">{title}</h2>
            </div>
          )}
          <button onClick={handleClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        {sending && (
          <div className="mb-2 flex items-center gap-2 text-xs text-soft">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
            Sharing...
          </div>
        )}

        {selectedSpace ? (
          /* Step 2: Channel selection */
          <>
            <p className="mb-3 text-xs text-muted">Select a channel</p>
            <div className="max-h-72 overflow-y-auto">
              {availableChannels.length === 0 ? (
                <p className="py-4 text-center text-sm text-soft">
                  No matching channels in this space.
                </p>
              ) : (
                availableChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    onSelect={handleChannelSelect}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          /* Step 1: Space selection */
          <>
            {writableSpaces.length > 5 && (
              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search spaces..."
                  className="w-full rounded-xl border border-edge bg-field pl-9 pr-3 py-2 text-sm text-heading placeholder-muted outline-none focus:border-pulse/30"
                  autoFocus
                />
              </div>
            )}

            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-4 text-center text-sm text-soft">
                  {writableSpaces.length === 0
                    ? "No writable spaces. Join or create a space first."
                    : "No spaces match your search."}
                </p>
              ) : (
                filtered.map((space) => (
                  <SpaceRow
                    key={space.id}
                    space={space}
                    onSelect={handleSpaceClick}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
