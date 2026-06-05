/**
 * The human approval gate for a model-proposed write — the real backstop against
 * prompt-injection → tool-abuse (agentic-safety research). Shows the EXACT draft
 * (Intent Preview), where it goes, and Approve / Edit / Cancel. Nothing is signed
 * until Approve; while publishing the button is disabled (no optimistic UI), and
 * the result (or error) is shown after. NIP-46 signers can take seconds — the
 * pending state says so.
 */
import { useState } from "react";
import {
  ShieldCheck,
  Pencil,
  X,
  Check,
  Loader2,
  AlertTriangle,
  FileText,
  Newspaper,
  Send,
  Users as UsersIcon,
  MessageCircle,
} from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import { selectPendingWriteById } from "@/store/slices/aiSlice";
import type { PendingWrite, PendingWriteKind } from "@/types/ai";
import { approvePendingWrite, cancelPendingWrite } from "./approveWrite";

/** Truncated npub so the approver verifies the real destination, not just a
 *  (attacker-influenceable) display name. */
function shortNpub(hex?: string): string | null {
  if (!hex) return null;
  try {
    const n = npubEncode(hex);
    return `${n.slice(0, 11)}…${n.slice(-4)}`;
  } catch {
    return `${hex.slice(0, 8)}…`;
  }
}

const KIND_ICON: Record<PendingWriteKind, typeof FileText> = {
  note: FileText,
  reply: MessageCircle,
  dm: Send,
  space_message: UsersIcon,
  article: Newspaper,
};

export function PendingWriteCard({ id }: { id: string }) {
  const write = useAppSelector(selectPendingWriteById(id));
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");

  if (!write) return null;
  const Icon = KIND_ICON[write.kind] ?? FileText;
  const busy = write.status === "publishing";
  const resolved = write.status === "done" || write.status === "cancelled";

  const startEdit = () => {
    setContent(write.content);
    setTitle(write.title ?? "");
    setEditing(true);
  };

  const approve = () =>
    void approvePendingWrite(
      write,
      editing ? { content, title: write.kind === "article" ? title : undefined } : undefined,
    );

  return (
    <div className="mx-auto my-2 max-w-2xl px-4">
      <div
        className={cn(
          "rounded-xl border p-3",
          write.status === "error"
            ? "border-red-500/40 bg-red-500/5"
            : write.status === "done"
              ? "border-green-500/30 bg-green-500/5"
              : "border-primary/40 bg-primary/5",
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={15} className="shrink-0 text-primary" />
          <span className="text-xs font-semibold text-heading">
            AI wants to {summaryVerb(write)}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted">
            <Icon size={12} />
            {targetLabel(write)}
          </span>
        </div>

        {write.kind === "article" && (
          <div className="mb-1.5">
            {editing ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-lg border border-border bg-field px-2.5 py-1.5 text-sm font-medium text-heading outline-none focus:border-primary/30"
              />
            ) : (
              <p className="text-sm font-semibold text-heading">{write.title}</p>
            )}
          </div>
        )}

        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={Math.min(Math.max(content.split("\n").length, 3), 12)}
            className="w-full resize-none rounded-lg border border-border bg-field px-2.5 py-2 text-sm text-heading outline-none focus:border-primary/30"
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap break-words rounded-lg bg-surface/60 px-2.5 py-2 text-sm text-body">
            {write.content}
          </p>
        )}

        {write.status === "error" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle size={13} />
            <span>{write.error}</span>
          </div>
        )}

        {write.status === "done" ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
            <Check size={13} />
            <span>{write.result}</span>
          </div>
        ) : write.status === "cancelled" ? (
          <div className="mt-2 text-xs text-muted">Cancelled.</div>
        ) : (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={approve}
              disabled={busy || resolved}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg transition-[filter] hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {busy ? "Waiting for signer…" : "Approve & publish"}
            </button>
            {!editing && (
              <button
                onClick={startEdit}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-soft transition-colors hover:bg-surface hover:text-heading disabled:opacity-50"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            <button
              onClick={() => cancelPendingWrite(write.id)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-soft transition-colors hover:bg-surface hover:text-heading disabled:opacity-50"
            >
              <X size={13} /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function summaryVerb(write: PendingWrite): string {
  switch (write.kind) {
    case "note":
      return "post a public note";
    case "reply":
      return "post a public reply";
    case "dm":
      return `send a DM to ${write.recipientLabel ?? "someone"}`;
    case "space_message":
      return "post to a space";
    case "article":
      return "publish an article";
  }
}

function targetLabel(write: PendingWrite): string {
  switch (write.kind) {
    case "dm": {
      const npub = shortNpub(write.recipientPubkey);
      const label = write.recipientLabel ?? "DM";
      return npub ? `${label} · ${npub}` : label;
    }
    case "space_message":
      return write.summary.replace(/^Post to /, "");
    default:
      return "public · your relays";
  }
}
