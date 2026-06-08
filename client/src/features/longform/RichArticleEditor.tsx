import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  Code,
  Quote,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
  Type,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { blossomUpload } from "@/lib/api/blossom";
import { useClickOutside } from "@/hooks/useClickOutside";
import "./richEditor.css";

interface RichArticleEditorProps {
  /** Article body as Markdown — the single source of truth. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

const EDITOR_CLASS =
  "prose prose-invert max-w-none min-h-[360px] px-4 py-3 focus:outline-none " +
  "prose-headings:text-heading prose-strong:text-heading prose-p:text-body " +
  "prose-a:text-primary-soft prose-code:text-primary-soft prose-pre:bg-panel " +
  "prose-blockquote:text-soft prose-li:text-body";

function imageFileFrom(list: DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const item of list) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f && f.type.startsWith("image/")) return f;
    }
  }
  return null;
}

/**
 * WYSIWYG article body editor (Tiptap/ProseMirror) that reads and writes plain
 * Markdown, so it drops into the existing editor without changing the publish,
 * preview, or draft pipeline. Lazy-loaded by {@link ArticleEditor} to keep
 * ProseMirror out of the main bundle.
 *
 * SECURITY: `Markdown.configure({ html: false })` means typed/pasted raw HTML is
 * never round-tripped into the article's markdown — consistent with the
 * no-`rehype-raw` rendering contract (see ArticleMarkdown / nostr-security).
 */
export function RichArticleEditor({ value, onChange, placeholder }: RichArticleEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showHeadings, setShowHeadings] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const headingRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);

  useClickOutside(headingRef, () => setShowHeadings(false), showHeadings);
  useClickOutside(linkRef, () => setShowLink(false), showLink);

  const insertImageFromFile = useCallback(async (file: File) => {
    const ed = editorRef.current;
    if (!ed || !file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const res = await blossomUpload(file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      ed.chain().focus().setImage({ src: res.url, alt }).run();
    } catch {
      /* upload failed — surfaced by the editor's empty insert (no-op) */
    } finally {
      setUploading(false);
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Write your article…" }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true, breaks: false }),
    ],
    content: value,
    editorProps: {
      attributes: { class: EDITOR_CLASS },
      handlePaste: (_view, event) => {
        const file = imageFileFrom(event.clipboardData?.items);
        if (file) {
          insertImageFromFile(file);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const file = imageFileFrom(event.dataTransfer?.items);
        if (file) {
          event.preventDefault();
          insertImageFromFile(file);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.storage.markdown.getMarkdown()),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Sync external markdown changes (e.g. switching back from Markdown mode)
  // without re-dispatching our own updates into a loop.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (value !== ed.storage.markdown.getMarkdown()) {
      ed.commands.setContent(value, false);
    }
  }, [value]);

  const applyLink = () => {
    const url = linkUrl.trim();
    setShowLink(false);
    if (!editor) return;
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  const btn = (active: boolean) =>
    `flex items-center justify-center rounded-md p-1.5 transition-colors ${
      active ? "bg-primary/20 text-primary" : "text-soft hover:bg-surface-hover hover:text-heading"
    }`;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {/* Toolbar */}
      <div className="relative flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <button
          type="button"
          title="Bold"
          className={btn(!!editor?.isActive("bold"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          title="Italic"
          className={btn(!!editor?.isActive("italic"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}
        >
          <Italic size={16} />
        </button>

        {/* Heading menu */}
        <div className="relative" ref={headingRef}>
          <button
            type="button"
            title="Heading"
            className={btn(!!editor?.isActive("heading"))}
            onMouseDown={(e) => { e.preventDefault(); setShowHeadings((v) => !v); }}
          >
            <Type size={16} />
          </button>
          {showHeadings && (
            <div
              className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-border-light"
              style={{ backgroundColor: "var(--color-card)", boxShadow: "var(--shadow-elevated)" }}
            >
              {([
                { level: 1 as const, label: "Big title", cls: "text-base font-bold" },
                { level: 2 as const, label: "Section title", cls: "text-sm font-semibold" },
                { level: 3 as const, label: "Small title", cls: "text-xs font-semibold" },
              ]).map((h) => (
                <button
                  key={h.level}
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-heading hover:bg-surface-hover ${h.cls} ${
                    editor?.isActive("heading", { level: h.level }) ? "bg-primary/10" : ""
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowHeadings(false);
                    editor?.chain().focus().toggleHeading({ level: h.level }).run();
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          title="Bulleted list"
          className={btn(!!editor?.isActive("bulletList"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
        >
          <List size={16} />
        </button>
        <button
          type="button"
          title="Numbered list"
          className={btn(!!editor?.isActive("orderedList"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          title="Quote"
          className={btn(!!editor?.isActive("blockquote"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBlockquote().run(); }}
        >
          <Quote size={16} />
        </button>

        <span className="mx-1 h-5 w-px bg-border" />

        {/* Link */}
        <div className="relative" ref={linkRef}>
          <button
            type="button"
            title="Insert link"
            className={btn(!!editor?.isActive("link"))}
            onMouseDown={(e) => {
              e.preventDefault();
              setLinkUrl(editor?.getAttributes("link").href ?? "");
              setShowLink(true);
            }}
          >
            <Link2 size={16} />
          </button>
          {showLink && (
            <div
              className="absolute left-0 top-full z-50 mt-1 flex w-72 items-center gap-1 rounded-lg border border-border-light p-1.5"
              style={{ backgroundColor: "var(--color-card)", boxShadow: "var(--shadow-elevated)" }}
            >
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                  if (e.key === "Escape") { e.preventDefault(); setShowLink(false); }
                }}
                placeholder="Paste a link (https://…)"
                className="min-w-0 flex-1 rounded-md border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted outline-none focus:border-primary/40"
              />
              <button type="button" title="Apply" className="rounded-md p-1 text-primary hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>
                <Check size={14} />
              </button>
              <button type="button" title="Cancel" className="rounded-md p-1 text-soft hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); setShowLink(false); }}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Image */}
        <button
          type="button"
          title="Add image"
          className={btn(false)}
          disabled={uploading}
          onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click(); }}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
        </button>

        <span className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          title="Inline code"
          className={btn(!!editor?.isActive("code"))}
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleCode().run(); }}
        >
          <Code size={16} />
        </button>
      </div>

      <EditorContent editor={editor} />

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImageFromFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
