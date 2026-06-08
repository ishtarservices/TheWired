import { useMemo, useRef, useState } from "react";
import { Link2, Send, Users } from "lucide-react";
import { nip19 } from "nostr-tools";
import { PopoverMenu, PopoverMenuItem } from "@/components/ui/PopoverMenu";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { useAppSelector } from "@/store/hooks";
import { sendDM } from "@/features/dm/dmService";
import { copyToClipboard } from "@/lib/clipboard";
import { buildChatMessage } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

interface NoteShareMenuProps {
  /** The note/event being shared. */
  event: NostrEvent;
  /** The Share button the menu anchors to. `null` = closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Relay hints to bake into the nevent (e.g. a decentralized space's host relay). */
  relays?: string[];
}

/**
 * Share affordances for a note: copy a portable `nostr:nevent` link, forward it
 * to a DM, or post it into a space chat channel (where it renders as an embed
 * card). Reused across the spaces feed, profile notes, and inline embeds.
 */
export function NoteShareMenu({ event, anchorEl, onClose, relays }: NoteShareMenuProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [dmOpen, setDmOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);

  // Stable ref object PopoverMenu can read `.current` from across renders.
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchorEl;

  const nostrUri = useMemo(() => {
    const nevent = nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      relays: relays && relays.length ? relays : undefined,
    });
    return `nostr:${nevent}`;
  }, [event.id, event.pubkey, relays]);

  const handleCopy = () => {
    copyToClipboard(nostrUri);
    onClose();
  };

  const handleShareToDM = async (recipientPubkey: string) => {
    await sendDM(recipientPubkey, nostrUri);
  };

  const handleShareToSpace = async (space: Space, channel: SpaceChannel) => {
    if (!pubkey) return;
    relayManager.connect(space.hostRelay, "read+write");
    try {
      await relayManager.waitForConnection(space.hostRelay, 5000);
    } catch {
      // Publish anyway — the relay may already be connecting.
    }
    const unsigned = buildChatMessage(pubkey, space.id, nostrUri, undefined, channel.id);
    await signAndPublish(unsigned, [space.hostRelay]);
  };

  // The popover and the two pickers are mutually exclusive.
  const menuOpen = anchorEl != null && !dmOpen && !spaceOpen;

  return (
    <>
      <PopoverMenu open={menuOpen} onClose={onClose} anchorRef={anchorRef} position="below">
        <PopoverMenuItem icon={<Link2 size={14} />} label="Copy link" onClick={handleCopy} />
        <PopoverMenuItem
          icon={<Send size={14} />}
          label="Forward to DM"
          onClick={() => setDmOpen(true)}
        />
        <PopoverMenuItem
          icon={<Users size={14} />}
          label="Share to a space"
          onClick={() => setSpaceOpen(true)}
        />
      </PopoverMenu>

      {dmOpen && (
        <RecipientPickerModal
          open={dmOpen}
          onClose={() => {
            setDmOpen(false);
            onClose();
          }}
          onSelect={handleShareToDM}
          title="Forward to"
        />
      )}

      {spaceOpen && (
        <SpacePickerModal
          open={spaceOpen}
          onClose={() => {
            setSpaceOpen(false);
            onClose();
          }}
          onSelect={handleShareToSpace}
          channelTypes={["chat"]}
        />
      )}
    </>
  );
}
