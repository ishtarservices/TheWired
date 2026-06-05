/**
 * "Publish out" menu for AI output — maps assistant text/artifacts to Nostr
 * events through the SAME seams the music feature uses (TrackActionPanel):
 * kind:1 note, kind:30023 article, kind:9 space message, NIP-17 DM. This path is
 * NOT the agentic gate — the user is the actor clicking publish, so AI text is
 * clipboard-equivalent here. Hidden entirely for read-only logins (no signer).
 */
import { useRef, useState } from "react";
import {
  MoreHorizontal,
  FileText,
  Newspaper,
  Users as UsersIcon,
  Send,
  Check,
  Loader2,
} from "lucide-react";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { store } from "@/store";
import { useAppSelector } from "@/store/hooks";
import { buildRootNote, buildChatMessage } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { sendDM } from "@/features/dm/dmService";
import type { Space, SpaceChannel } from "@/types/space";
import type { UnsignedEvent } from "@/types/nostr";
import { ArticleComposeModal } from "./ArticleComposeModal";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

export function AIPublishMenu({ text, title }: { text: string; title?: string }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dmPicker, setDmPicker] = useState(false);
  const [spacePicker, setSpacePicker] = useState(false);
  const [articleOpen, setArticleOpen] = useState(false);

  const hasSigner = useAppSelector((s) => s.identity.signerType !== null && !!s.identity.pubkey);
  if (!hasSigner) return null;

  const myPubkey = () => store.getState().identity.pubkey;

  const run = async (fn: () => Promise<void>) => {
    setStatus({ kind: "busy" });
    try {
      await fn();
      setStatus({ kind: "done" });
      setOpen(false);
      window.setTimeout(() => setStatus({ kind: "idle" }), 1800);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Failed to publish" });
    }
  };

  const publishNote = () =>
    run(async () => {
      const pk = myPubkey();
      if (!pk) throw new Error("Not logged in");
      await signAndPublish(buildRootNote(pk, text));
    });

  const postToSpace = (space: Space, channel: SpaceChannel) =>
    run(async () => {
      const pk = myPubkey();
      if (!pk) throw new Error("Not logged in");
      relayManager.connect(space.hostRelay, "read+write");
      try {
        await relayManager.waitForConnection(space.hostRelay, 5000);
      } catch {
        /* publish anyway; relay may still accept */
      }
      const unsigned: UnsignedEvent =
        channel.type === "chat"
          ? buildChatMessage(pk, space.id, text, undefined, channel.id)
          : { pubkey: pk, created_at: Math.floor(Date.now() / 1000), kind: 1, tags: [], content: text };
      await signAndPublish(unsigned, [space.hostRelay]);
    });

  const sendToDM = (recipient: string) => run(async () => { await sendDM(recipient, text); });

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading"
        title="Publish"
        aria-label="Publish AI output"
      >
        {status.kind === "busy" ? (
          <Loader2 size={14} className="animate-spin" />
        ) : status.kind === "done" ? (
          <Check size={14} className="text-green-400" />
        ) : (
          <MoreHorizontal size={14} />
        )}
      </button>

      <PopoverMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} position="below">
        <PopoverMenuItem icon={<FileText size={14} />} label="Publish as note" onClick={publishNote} />
        <PopoverMenuItem
          icon={<Newspaper size={14} />}
          label="Publish as article"
          onClick={() => { setOpen(false); setArticleOpen(true); }}
        />
        <PopoverMenuItem
          icon={<UsersIcon size={14} />}
          label="Post to space"
          onClick={() => { setOpen(false); setSpacePicker(true); }}
        />
        <PopoverMenuItem
          icon={<Send size={14} />}
          label="Send as DM"
          onClick={() => { setOpen(false); setDmPicker(true); }}
        />
        {status.kind === "error" && (
          <>
            <PopoverMenuSeparator />
            <div className="px-3.5 py-1 text-xs text-red-400">{status.message}</div>
          </>
        )}
      </PopoverMenu>

      {dmPicker && (
        <RecipientPickerModal
          open={dmPicker}
          onClose={() => setDmPicker(false)}
          onSelect={sendToDM}
        />
      )}
      {spacePicker && (
        <SpacePickerModal
          open={spacePicker}
          onClose={() => setSpacePicker(false)}
          onSelect={postToSpace}
          channelTypes={["chat", "notes"]}
          title="Post to Space"
        />
      )}
      {articleOpen && (
        <ArticleComposeModal
          open={articleOpen}
          onClose={() => setArticleOpen(false)}
          initialContent={text}
          initialTitle={title}
        />
      )}
    </>
  );
}
