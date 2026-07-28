import { useState, useCallback } from "react";
import {
  Eye,
  EyeOff,
  FileText,
  Repeat2,
  MessageSquare,
  ImageIcon,
  BookOpen,
  Mic2,
  Music2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAppSelector } from "@/store/hooks";
import { useProfileSettings } from "@/features/profile/useProfileSettings";
import {
  type ProfileSettings,
  type ProfileTab,
  ALL_TABS,
} from "@/features/profile/profileSettings";

const TAB_META: { id: ProfileTab; label: string; icon: typeof FileText }[] = [
  { id: "notes", label: "Notes", icon: FileText },
  { id: "reposts", label: "Reposts", icon: Repeat2 },
  { id: "replies", label: "Replies", icon: MessageSquare },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "reads", label: "Reads", icon: BookOpen },
  { id: "music", label: "Music", icon: Mic2 },
  { id: "showcase", label: "Library", icon: Music2 },
];

export function ProfileDisplaySection() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { settings, loading, updateSettings } = useProfileSettings(pubkey);

  const [draft, setDraft] = useState<ProfileSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Work on a draft so changes aren't committed until Save
  const current = draft ?? settings;
  const isDirty = draft !== null;

  const toggleTab = useCallback(
    (tab: ProfileTab) => {
      const cur = current.visibleTabs;
      const next = cur.includes(tab)
        ? cur.filter((t) => t !== tab)
        : [...cur, tab];
      // Must keep at least one tab visible
      if (next.length === 0) return;
      // Preserve canonical order
      setDraft({ visibleTabs: ALL_TABS.filter((t) => next.includes(t)) });
      setSuccess(false);
    },
    [current.visibleTabs],
  );

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateSettings(draft);
      setDraft(null);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [draft, updateSettings]);

  const handleReset = useCallback(() => {
    setDraft(null);
    setSuccess(false);
    setError(null);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg rounded-xl border border-border bg-panel p-4">
        <div className="flex items-center gap-2 py-4 justify-center">
          <Spinner size="sm" />
          <span className="text-xs text-muted">Loading display settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-1 text-sm font-semibold text-heading">
        Profile Sections
      </h3>
      <p className="mb-4 text-xs text-muted">
        Choose which sections are public when others view your profile on The
        Wired. Your own profile always shows every section.
      </p>

      {/* ── Visible tabs ────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap gap-2">
          {TAB_META.map(({ id, label, icon: Icon }) => {
            const active = current.visibleTabs.includes(id);
            return (
              <button
                key={id}
                onClick={() => toggleTab(id)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted hover:bg-surface-hover hover:text-heading"
                }`}
              >
                <Icon size={13} />
                {label}
                {active ? (
                  <Eye size={11} className="ml-0.5 opacity-60" />
                ) : (
                  <EyeOff size={11} className="ml-0.5 opacity-40" />
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          At least one section must remain visible.
        </p>
      </div>

      {/* ── Feedback & actions ──────────────────────────────────── */}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {success && (
        <p className="mt-3 text-xs text-green-400">Display settings saved!</p>
      )}

      {isDirty && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={handleReset}
            className="rounded-md px-3 py-1.5 text-xs text-soft hover:bg-surface-hover transition-colors"
          >
            Discard
          </button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" /> : "Save Display Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
