import { useEffect } from "react";
import { Globe, Users } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import type { ArticleVisibility } from "./useArticleDraft";

interface ArticleVisibilityPickerProps {
  value: ArticleVisibility;
  onChange: (v: ArticleVisibility) => void;
  spaceId: string;
  onSpaceIdChange: (id: string) => void;
  channelId: string;
  onChannelIdChange: (id: string) => void;
}

const OPTIONS: { value: ArticleVisibility; label: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", icon: Globe },
  { value: "space", label: "Space-exclusive", icon: Users },
];

/**
 * Public vs space-exclusive selector for articles. The space list is filtered to
 * spaces you can actually publish to (writable + has a relay) so you're never
 * offered a read-only space that the publish guard would reject. "Space-exclusive"
 * is soft (host-relay scoped + member-filtered in-app), and the copy says so.
 */
export function ArticleVisibilityPicker({
  value,
  onChange,
  spaceId,
  onSpaceIdChange,
  channelId,
  onChannelIdChange,
}: ArticleVisibilityPickerProps) {
  const spaces = useAppSelector((s) => s.spaces.list);
  const allChannels = useAppSelector((s) => s.spaces.channels);

  // Only spaces you can post to: writable mode + a relay to publish to.
  const writableSpaces = spaces.filter((s) => s.mode === "read-write" && !!s.hostRelay);

  const articleChannels = spaceId
    ? (allChannels[spaceId] ?? []).filter((c) => c.type === "articles")
    : [];

  // When a space is chosen, resolve to a concrete articles channel (its default,
  // else the first) instead of an empty "no channel" state — so a space article
  // always carries a real channel tag.
  const articleChannelIds = articleChannels.map((c) => c.id).join(",");
  useEffect(() => {
    if (value !== "space" || articleChannels.length === 0) return;
    if (articleChannels.some((c) => c.id === channelId)) return;
    const def = articleChannels.find((c) => c.isDefault) ?? articleChannels[0];
    onChannelIdChange(def.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, spaceId, channelId, articleChannelIds]);

  const select =
    "w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading outline-none focus:border-primary/40 transition-colors";

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-soft">Who can see this</label>

      <div className="inline-flex rounded-xl border border-border p-0.5">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-primary/20 text-primary" : "text-soft hover:text-heading"
              }`}
            >
              <Icon size={13} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {value === "space" && (
        <div className="mt-2.5 space-y-2">
          {writableSpaces.length === 0 ? (
            <p className="text-xs text-muted">
              You're not a member of any space you can post to yet.
            </p>
          ) : (
            <select
              value={spaceId}
              onChange={(e) => {
                onSpaceIdChange(e.target.value);
                onChannelIdChange("");
              }}
              className={select}
            >
              <option value="">Select a space</option>
              {writableSpaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          {articleChannels.length > 1 && (
            <select
              value={channelId}
              onChange={(e) => onChannelIdChange(e.target.value)}
              className={select}
            >
              {articleChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label}
                </option>
              ))}
            </select>
          )}

          <p className="text-[11px] leading-relaxed text-muted">
            Published only to the space's relay and shown to members in the app — not cryptographic
            privacy, so don't put secrets in an article.
          </p>
        </div>
      )}
    </div>
  );
}
