import { useCallback, useRef, useState, type RefObject } from "react";
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
import { wrapSelection, type WrapResult } from "@/lib/content/wrapSelection";
import {
  toggleHeading,
  toggleBulletList,
  toggleNumberList,
  toggleQuote,
  insertLink,
  insertImage,
  type BlockResult,
} from "@/lib/content/markdownBlock";
import { blossomUpload } from "@/lib/api/blossom";
import { useClickOutside } from "@/hooks/useClickOutside";

interface ArticleToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
}

/**
 * Friendly, labeled formatting toolbar for the article editor. Buttons do the
 * markdown for the user — they never need to know what markdown is. Pairs with
 * the live Preview tab and {@link useMarkdownShortcuts} (keyboard) in the editor.
 */
export function ArticleToolbar({ textareaRef, value, setValue }: ArticleToolbarProps) {
  const [showHeadings, setShowHeadings] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const headingRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Selection captured when opening a sub-popover (focus moves to the input).
  const savedSel = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  useClickOutside(headingRef, () => setShowHeadings(false), showHeadings);
  useClickOutside(linkRef, () => setShowLink(false), showLink);

  const apply = useCallback(
    (result: WrapResult | BlockResult) => {
      setValue(result.newValue);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(result.newCursorStart, result.newCursorEnd);
      });
    },
    [setValue, textareaRef],
  );

  const inline = (marker: string, blockLevel?: boolean) => {
    const ta = textareaRef.current;
    if (!ta) return;
    apply(wrapSelection(value, ta.selectionStart, ta.selectionEnd, marker, blockLevel));
  };

  const block = (fn: (v: string, s: number, e: number) => BlockResult) => {
    const ta = textareaRef.current;
    if (!ta) return;
    apply(fn(value, ta.selectionStart, ta.selectionEnd));
  };

  const captureSelection = () => {
    const ta = textareaRef.current;
    savedSel.current = ta
      ? { start: ta.selectionStart, end: ta.selectionEnd }
      : { start: value.length, end: value.length };
  };

  const openLink = () => {
    captureSelection();
    setLinkUrl("");
    setShowLink(true);
  };

  const confirmLink = () => {
    const url = linkUrl.trim();
    setShowLink(false);
    if (!url) return;
    apply(insertLink(value, savedSel.current.start, savedSel.current.end, { url }));
  };

  const handleImageFile = async (file: File) => {
    setUploadError(null);
    if (!file.type.startsWith("image/")) {
      setUploadError("Only image files are supported");
      return;
    }
    setUploading(true);
    try {
      const res = await blossomUpload(file);
      // Read the freshest value so an async upload can't clobber meanwhile-typed text.
      const cur = textareaRef.current?.value ?? value;
      const alt = file.name.replace(/\.[^.]+$/, "");
      apply(insertImage(cur, cur.length, cur.length, { url: res.url, alt }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const btn =
    "flex items-center justify-center rounded-md p-1.5 text-soft hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="relative flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
      <button type="button" title="Bold" className={btn} onMouseDown={(e) => { e.preventDefault(); inline("**"); }}>
        <Bold size={16} />
      </button>
      <button type="button" title="Italic" className={btn} onMouseDown={(e) => { e.preventDefault(); inline("*"); }}>
        <Italic size={16} />
      </button>

      {/* Heading menu — plain-English labels, not "H1/H2/H3" */}
      <div className="relative" ref={headingRef}>
        <button
          type="button"
          title="Heading"
          className={btn}
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
                className={`block w-full px-3 py-2 text-left text-heading hover:bg-surface-hover ${h.cls}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowHeadings(false);
                  block((v, s, en) => toggleHeading(v, s, en, h.level));
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="mx-1 h-5 w-px bg-border" />

      <button type="button" title="Bulleted list" className={btn} onMouseDown={(e) => { e.preventDefault(); block(toggleBulletList); }}>
        <List size={16} />
      </button>
      <button type="button" title="Numbered list" className={btn} onMouseDown={(e) => { e.preventDefault(); block(toggleNumberList); }}>
        <ListOrdered size={16} />
      </button>
      <button type="button" title="Quote" className={btn} onMouseDown={(e) => { e.preventDefault(); block(toggleQuote); }}>
        <Quote size={16} />
      </button>

      <span className="mx-1 h-5 w-px bg-border" />

      {/* Insert link */}
      <div className="relative" ref={linkRef}>
        <button type="button" title="Insert link" className={btn} onMouseDown={(e) => { e.preventDefault(); openLink(); }}>
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
                if (e.key === "Enter") { e.preventDefault(); confirmLink(); }
                if (e.key === "Escape") { e.preventDefault(); setShowLink(false); }
              }}
              placeholder="Paste a link (https://…)"
              className="min-w-0 flex-1 rounded-md border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted outline-none focus:border-primary/40"
            />
            <button type="button" title="Add link" className="rounded-md p-1 text-primary hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); confirmLink(); }}>
              <Check size={14} />
            </button>
            <button type="button" title="Cancel" className="rounded-md p-1 text-soft hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); setShowLink(false); }}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Insert image (uploads, then inserts) */}
      <button
        type="button"
        title="Add image"
        className={btn}
        disabled={uploading}
        onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click(); }}
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
      </button>

      <span className="mx-1 h-5 w-px bg-border" />

      <button type="button" title="Inline code" className={btn} onMouseDown={(e) => { e.preventDefault(); inline("`"); }}>
        <Code size={16} />
      </button>

      <span className="ml-auto pr-1 text-[11px] text-muted">
        Use the buttons to format — no markdown needed
      </span>

      {uploadError && (
        <p className="w-full px-1 pt-1 text-[11px] text-red-400">{uploadError}</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
