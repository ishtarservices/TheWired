import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, MessageSquare, Trash2, Pencil, MoreHorizontal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectConversationsSorted,
  selectActiveConversationId,
  setActiveConversation,
} from "@/store/slices/aiSlice";
import {
  PopoverMenu,
  PopoverMenuItem,
} from "@/components/ui/PopoverMenu";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import type { AIConversation } from "@/types/ai";
import {
  createConversation,
  deleteConversationEverywhere,
  renameConversationEverywhere,
} from "./conversationActions";

/** Left-rail conversation list shown when the AI tab is active. */
export function AISidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const conversations = useAppSelector(selectConversationsSorted);
  const activeId = useAppSelector(selectActiveConversationId);
  const [query, setQuery] = useState("");

  const newChat = () => {
    createConversation();
    navigate("/");
  };

  const select = (id: string) => {
    dispatch(setActiveConversation(id));
    navigate("/");
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) => c.title.toLowerCase().includes(q))
    : conversations;

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4 pb-2">
        <button
          onClick={newChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Plus size={14} />
          New chat
        </button>
      </div>

      {conversations.length > 5 && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-lg bg-field py-1.5 pl-8 pr-2 text-xs text-heading placeholder-muted outline-none ring-1 ring-border focus:ring-primary/30"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">
            {q ? "No matching chats." : "No conversations yet."}
          </div>
        ) : (
          filtered.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onSelect={() => select(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
}: {
  conversation: AIConversation;
  active: boolean;
  onSelect: () => void;
}) {
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const rel = useRelativeTime(Math.floor(conversation.updatedAt / 1000));

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const startEdit = () => {
    setTitle(conversation.title);
    setEditing(true);
    closeMenu();
  };

  const commitRename = () => {
    const next = title.trim();
    if (next && next !== conversation.title) void renameConversationEverywhere(conversation.id, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
        <Pencil size={13} className="shrink-0 text-primary" />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commitRename}
          className="min-w-0 flex-1 bg-transparent text-xs text-heading outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-lg px-2.5 py-2 transition-colors",
        active ? "bg-surface-hover" : "hover:bg-surface",
      )}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <MessageSquare
          size={13}
          className={cn("shrink-0", active ? "text-primary" : "text-muted")}
        />
        <span className={cn("truncate text-xs", active ? "text-heading" : "text-soft")}>
          {conversation.title}
        </span>
      </button>
      <span className="shrink-0 text-[10px] tabular-nums text-muted">{rel}</span>
      <button
        ref={menuBtn}
        onClick={() => setMenuOpen((o) => !o)}
        className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:text-heading group-hover:opacity-100"
        title="Conversation actions"
        aria-label="Conversation actions"
      >
        <MoreHorizontal size={14} />
      </button>
      <PopoverMenu open={menuOpen} onClose={closeMenu} anchorRef={menuBtn} position="below">
        <PopoverMenuItem icon={<Pencil size={14} />} label="Rename" onClick={startEdit} />
        {confirmDelete ? (
          <PopoverMenuItem
            icon={<Trash2 size={14} />}
            label="Confirm delete"
            variant="danger"
            onClick={() => {
              void deleteConversationEverywhere(conversation.id);
              closeMenu();
            }}
          />
        ) : (
          <PopoverMenuItem
            icon={<Trash2 size={14} />}
            label="Delete"
            variant="danger"
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </PopoverMenu>
    </div>
  );
}
