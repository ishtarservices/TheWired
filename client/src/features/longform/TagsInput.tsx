import { useState } from "react";
import { X } from "lucide-react";

/**
 * Chip-style topic input. Stores its value as a comma-separated string (so it
 * round-trips through the draft + buildArticle hashtags unchanged) but presents
 * tags as removable chips with Enter/comma to add and Backspace to delete.
 */
export function TagsInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const tags = value
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);

  const setTags = (arr: string[]) => onChange(arr.join(", "));

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, "").toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setDraft("");
  };
  const remove = (t: string) => setTags(tags.filter((x) => x !== t));

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-field px-2.5 py-2 transition-colors focus-within:border-primary/40">
      {tags.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-xs text-primary-soft"
        >
          #{t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="rounded-full p-0.5 text-primary-soft/70 transition-colors hover:bg-primary/20 hover:text-primary-soft"
            title={`Remove #${t}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={tags.length ? "Add another…" : "Add topics (press Enter)"}
        className="min-w-[140px] flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
      />
    </div>
  );
}
