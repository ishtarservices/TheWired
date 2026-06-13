import { useState, useRef, useCallback, lazy, Suspense } from "react";
import { Send, Paperclip, Smile, Loader2, ImageIcon, BarChart3, X } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Avatar } from "@/components/ui/Avatar";
import { AnchoredPopover } from "@/components/ui/AnchoredPopover";
import { MentionAutocomplete } from "@/components/content/MentionAutocomplete";
import { EmojiAutocomplete } from "@/components/content/EmojiAutocomplete";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { GifPreview } from "@/components/chat/GifPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useAppSelector } from "@/store/hooks";
import { buildRootNote, buildPollEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { registerGifShare } from "@/lib/api/gif";
import type { AttachmentMeta } from "@/lib/nostr/eventBuilder";
import type { GifItem } from "@/types/emoji";
import type { EmojiSelectResult } from "@/components/chat/EmojiPicker";
import type { PollDraft } from "@/features/polls/PollComposer";

const LazyGifPicker = lazy(() =>
  import("@/components/chat/GifPicker").then((m) => ({ default: m.GifPicker })),
);
const LazyEmojiPicker = lazy(() =>
  import("@/components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);
const LazyPollComposer = lazy(() =>
  import("@/features/polls/PollComposer").then((m) => ({ default: m.PollComposer })),
);

/** Match @query at cursor position */
function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

/** Match :query at cursor position for emoji autocomplete */
function detectEmojiQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
  return match ? match[2] : null;
}

interface NoteComposerProps {
  /** Outer margin classes — override when embedding outside the profile page. */
  className?: string;
}

export function NoteComposer({ className = "mx-6 mt-4" }: NoteComposerProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const profile = useAppSelector((s) => s.identity.profile);
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPollComposer, setShowPollComposer] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
  const [pollDraft, setPollDraft] = useState<PollDraft | null>(null);
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const customEmojiMapRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gifBtnRef = useRef<HTMLButtonElement>(null);
  const pollBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  const {
    attachments,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    fileInputRef,
    isUploading,
    hasAttachments,
    addFiles,
  } = useFileUpload();

  useAutoResize(textareaRef, value, 200);

  const updateAutocompleteState = useCallback((val: string, cursor: number) => {
    setMentionQuery(detectMentionQuery(val, cursor));
    setEmojiQuery(detectEmojiQuery(val, cursor));
  }, []);

  const handleMentionSelect = useCallback(
    (pk: string, displayName: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/(^|\s)@\w*$/);
      if (!match) return;
      const prefix = before.slice(0, match.index! + match[1].length);
      const token = `@${displayName}`;
      const newValue = `${prefix}${token} ${after}`;
      mentionMapRef.current.set(displayName, pk);
      setValue(newValue);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + token.length + 1;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleEmojiAutocompleteSelect = useCallback(
    (shortcode: string, url: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
      if (!match) return;
      const prefix = before.slice(0, match.index! + match[1].length);
      const token = `:${shortcode}: `;
      const newValue = `${prefix}${token}${after}`;
      customEmojiMapRef.current.set(shortcode, url);
      setValue(newValue);
      setEmojiQuery(null);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + token.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleEmojiPickerSelect = useCallback(
    (emoji: EmojiSelectResult) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      let insertion: string;
      if (emoji.isCustom && emoji.shortcode && emoji.src) {
        insertion = `:${emoji.shortcode}: `;
        customEmojiMapRef.current.set(emoji.shortcode, emoji.src);
      } else if (emoji.native) {
        insertion = `${emoji.native} `;
      } else {
        return;
      }
      const newValue = `${before}${insertion}${after}`;
      setValue(newValue);
      setShowEmojiPicker(false);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = before.length + insertion.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleGifSelect = useCallback((gif: GifItem) => {
    setPendingGif(gif);
    setShowGifPicker(false);
    registerGifShare(gif.id).catch(() => {});
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleSubmit = useCallback(async () => {
    if (!pubkey) return;
    if (publishing || isUploading) return;

    // Poll post: the kind:1068 event IS the post (composer text, when present,
    // overrides the draft's question)
    if (pollDraft) {
      setPublishing(true);
      try {
        const writeRelays = relayManager
          .getWriteRelays()
          .map((c) => c.url)
          .slice(0, 4);
        const unsigned = buildPollEvent(
          pubkey,
          value.trim() || pollDraft.question,
          pollDraft.options,
          {
            pollType: pollDraft.pollType,
            endsAt: pollDraft.endsAt,
            relays: writeRelays,
          },
        );
        await signAndPublish(unsigned);
        setValue("");
        setPollDraft(null);
        setShowPollComposer(false);
        setExpanded(false);
      } finally {
        setPublishing(false);
      }
      return;
    }

    const hasContent = value.trim().length > 0;
    const hasDoneAttachments = attachments.some((a) => a.status === "done");
    if (!hasContent && !hasDoneAttachments && !pendingGif) return;

    setPublishing(true);
    try {
      let content = value.trim();
      const mentionPubkeys: string[] = [];

      // Replace @mentions with nostr: URIs
      for (const [displayName, pk] of mentionMapRef.current) {
        const token = `@${displayName}`;
        if (content.includes(token)) {
          const npub = npubEncode(pk);
          content = content.replaceAll(token, `nostr:${npub}`);
          mentionPubkeys.push(pk);
        }
      }

      // Build attachment metas and append URLs
      const attachmentMetas: AttachmentMeta[] = [];
      for (const att of attachments) {
        if (att.status === "done" && att.result) {
          attachmentMetas.push({
            url: att.result.url,
            mimeType: att.result.mimeType,
            sha256: att.result.sha256,
            size: att.result.size,
          });
          if (content.length > 0) content += "\n";
          content += att.result.url;
        }
      }

      // Append GIF URL
      if (pendingGif) {
        if (content.length > 0) content += "\n";
        content += pendingGif.url;
      }

      // Build NIP-30 emoji tags
      const emojiTags: string[][] = [];
      const shortcodeRe = /:([a-zA-Z0-9_]+):/g;
      let m: RegExpExecArray | null;
      while ((m = shortcodeRe.exec(content)) !== null) {
        const url = customEmojiMapRef.current.get(m[1]);
        if (url) {
          emojiTags.push(["emoji", m[1], url]);
        }
      }

      const unsigned = buildRootNote(
        pubkey,
        content,
        mentionPubkeys.length > 0 ? mentionPubkeys : undefined,
        attachmentMetas.length > 0 ? attachmentMetas : undefined,
        emojiTags.length > 0 ? emojiTags : undefined,
      );

      await signAndPublish(unsigned);

      // Reset state
      setValue("");
      setMentionQuery(null);
      setEmojiQuery(null);
      setPendingGif(null);
      setShowGifPicker(false);
      setShowEmojiPicker(false);
      mentionMapRef.current.clear();
      customEmojiMapRef.current.clear();
      clearAttachments();
      setExpanded(false);
    } finally {
      setPublishing(false);
    }
  }, [pubkey, value, attachments, pendingGif, pollDraft, publishing, isUploading, clearAttachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let autocomplete handle its own keys
    if (mentionQuery !== null || emojiQuery !== null) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (showGifPicker || showEmojiPicker || showPollComposer) {
        setShowGifPicker(false);
        setShowEmojiPicker(false);
        setShowPollComposer(false);
      } else if (!value.trim() && !hasAttachments && !pendingGif) {
        setExpanded(false);
      }
      return;
    }

    // Ctrl/Cmd+Enter to post
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!pubkey) return null;

  const displayName = profile?.display_name || profile?.name || pubkey.slice(0, 12);
  const hasContent = value.trim().length > 0 || hasAttachments || !!pendingGif || !!pollDraft;

  // Collapsed state
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
        className={`${className} flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-light hover:bg-surface-hover`}
      >
        <Avatar
          src={profile?.picture}
          alt={displayName}
          size="sm"
          className="h-8 w-8 shrink-0"
        />
        <span className="text-sm text-muted">What's on your mind?</span>
      </button>
    );
  }

  // Expanded state
  return (
    <div className={`relative ${className} rounded-xl border border-border bg-surface`}>
      {/* Popups render via AnchoredPopover (portal + fixed positioning) so
          they flip above/below to fit the viewport instead of being clipped
          when the composer sits at the top of a scroll container (Feed). */}

      {/* Autocomplete popups — anchored to the textarea */}
      <AnchoredPopover
        anchorEl={textareaRef.current}
        open={mentionQuery !== null}
        onClose={() => setMentionQuery(null)}
      >
        {mentionQuery !== null && (
          <MentionAutocomplete
            query={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setMentionQuery(null)}
          />
        )}
      </AnchoredPopover>
      <AnchoredPopover
        anchorEl={textareaRef.current}
        open={emojiQuery !== null}
        onClose={() => setEmojiQuery(null)}
      >
        {emojiQuery !== null && (
          <EmojiAutocomplete
            query={emojiQuery}
            onSelect={handleEmojiAutocompleteSelect}
            onClose={() => setEmojiQuery(null)}
          />
        )}
      </AnchoredPopover>

      {/* GIF Picker */}
      <AnchoredPopover
        anchorEl={gifBtnRef.current}
        open={showGifPicker}
        onClose={() => setShowGifPicker(false)}
      >
        <Suspense
          fallback={
            <div className="w-[360px] h-[420px] rounded-xl border border-border bg-panel flex items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          <LazyGifPicker
            onSelect={handleGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        </Suspense>
      </AnchoredPopover>

      {/* Emoji Picker */}
      <AnchoredPopover
        anchorEl={emojiBtnRef.current}
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
      >
        <Suspense
          fallback={
            <div className="w-[352px] h-[435px] rounded-xl border border-border bg-panel flex items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          <LazyEmojiPicker
            onEmojiSelect={handleEmojiPickerSelect}
            onClose={() => setShowEmojiPicker(false)}
          />
        </Suspense>
      </AnchoredPopover>

      {/* Poll Composer */}
      <AnchoredPopover
        anchorEl={pollBtnRef.current}
        open={showPollComposer}
        onClose={() => setShowPollComposer(false)}
      >
        <Suspense
          fallback={
            <div className="w-[min(460px,calc(100vw-24px))] h-[320px] rounded-xl border border-border bg-panel flex items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          <LazyPollComposer
            onSubmit={(draft) => {
              setPollDraft(draft);
              setShowPollComposer(false);
            }}
            onClose={() => setShowPollComposer(false)}
          />
        </Suspense>
      </AnchoredPopover>

      {/* Author header */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
        <Avatar
          src={profile?.picture}
          alt={displayName}
          size="sm"
          className="h-8 w-8 shrink-0"
        />
        <span className="text-sm font-medium text-heading">{displayName}</span>
      </div>

      {/* Textarea */}
      <div className="px-4 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateAutocompleteState(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => updateAutocompleteState(value, e.currentTarget.selectionStart)}
          onClick={(e) => updateAutocompleteState(value, e.currentTarget.selectionStart)}
          onPaste={handlePaste}
          placeholder="What's on your mind?"
          rows={3}
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          className="w-full resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none"
        />
      </div>

      {/* Attachment previews */}
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

      {/* GIF preview */}
      {pendingGif && (
        <GifPreview gif={pendingGif} onRemove={() => setPendingGif(null)} />
      )}

      {/* Attached poll draft */}
      {pollDraft && (
        <div className="mx-4 mb-2 flex items-center gap-2.5 rounded-lg border border-border bg-field/60 px-3 py-2">
          <BarChart3 size={15} className="shrink-0 text-primary-soft" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-heading">
              {value.trim() || pollDraft.question}
            </span>
            <span className="block text-xs text-muted">
              {pollDraft.options.length} options
              {pollDraft.pollType === "multiplechoice" ? " · multiple choice" : ""}
              {pollDraft.endsAt ? "" : " · no end time"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setPollDraft(null)}
            className="shrink-0 rounded p-1 text-muted hover:text-red-400 transition-colors"
            title="Remove poll"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openFilePicker}
            disabled={!!pollDraft}
            className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-40"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={!!pollDraft}
            className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-40"
            title="Add image"
          >
            <ImageIcon size={18} />
          </button>
          <button
            ref={gifBtnRef}
            type="button"
            onClick={() => {
              setShowGifPicker((prev) => !prev);
              setShowEmojiPicker(false);
              setShowPollComposer(false);
            }}
            disabled={!!pollDraft}
            className={`rounded-md px-1.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-40 ${
              showGifPicker
                ? "bg-primary/20 text-primary"
                : "text-muted hover:text-heading hover:bg-surface-hover"
            }`}
            title="Search GIFs"
          >
            GIF
          </button>
          <button
            ref={pollBtnRef}
            type="button"
            onClick={() => {
              setShowPollComposer((prev) => !prev);
              setShowGifPicker(false);
              setShowEmojiPicker(false);
            }}
            disabled={!!pollDraft || hasAttachments || !!pendingGif}
            className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
              showPollComposer
                ? "bg-primary/20 text-primary"
                : "text-muted hover:text-heading hover:bg-surface-hover"
            }`}
            title="Create a poll"
          >
            <BarChart3 size={18} />
          </button>
          <button
            ref={emojiBtnRef}
            type="button"
            onClick={() => {
              setShowEmojiPicker((prev) => !prev);
              setShowGifPicker(false);
              setShowPollComposer(false);
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              showEmojiPicker
                ? "bg-primary/20 text-primary"
                : "text-muted hover:text-heading hover:bg-surface-hover"
            }`}
            title="Emoji"
          >
            <Smile size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setValue("");
              clearAttachments();
              setPendingGif(null);
              setPollDraft(null);
              setShowPollComposer(false);
              mentionMapRef.current.clear();
              customEmojiMapRef.current.clear();
              setExpanded(false);
            }}
            className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || publishing || isUploading}
            className="flex items-center gap-1.5 rounded-lg bg-primary/20 px-4 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Post
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,application/pdf"
        className="hidden"
        onChange={handleFileInputChange}
      />
    </div>
  );
}
