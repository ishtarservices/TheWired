import { useState, useCallback } from "react";
import { BarChart3, Plus, X, Music, Check } from "lucide-react";
import { TrackSearchPanel } from "./TrackSearchPanel";
import type { MusicSearchHit } from "../music/useMusicSearch";

export interface PollDraftOption {
  id: string;
  label: string;
  /** "31683:pubkey:dTag" when a music track is attached */
  trackAddress?: string;
}

export interface PollDraft {
  question: string;
  options: PollDraftOption[];
  pollType: "singlechoice" | "multiplechoice";
  /** Unix seconds */
  endsAt?: number;
}

const MAX_OPTIONS = 10;

const DURATIONS: { label: string; seconds?: number }[] = [
  { label: "1h", seconds: 3600 },
  { label: "8h", seconds: 8 * 3600 },
  { label: "24h", seconds: 86400 },
  { label: "3d", seconds: 3 * 86400 },
  { label: "7d", seconds: 7 * 86400 },
  { label: "No end" },
];

interface OptionState {
  id: string;
  label: string;
  trackAddress?: string;
  trackTitle?: string;
  trackArtist?: string;
  trackImage?: string;
}

function newOption(): OptionState {
  return { id: crypto.randomUUID(), label: "" };
}

interface PollComposerProps {
  onSubmit: (draft: PollDraft) => void;
  onClose: () => void;
  /** Show the per-option "attach track" affordance (music library search) */
  allowMusicOptions?: boolean;
}

/** Poll creation panel (shared by the chat popover and the note composer).
 *  Caller positions it; this renders the bordered panel itself. */
export function PollComposer({ onSubmit, onClose, allowMusicOptions = true }: PollComposerProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<OptionState[]>([newOption(), newOption()]);
  const [multi, setMulti] = useState(false);
  const [durationIdx, setDurationIdx] = useState(2); // default 24h
  const [trackSearchIdx, setTrackSearchIdx] = useState<number | null>(null);

  const setOptionLabel = useCallback((idx: number, label: string) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, label } : o)));
  }, []);

  const removeOption = useCallback((idx: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    setTrackSearchIdx(null);
  }, []);

  const addOption = useCallback(() => {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, newOption()]));
  }, []);

  const attachTrack = useCallback((idx: number, hit: MusicSearchHit) => {
    setOptions((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              trackAddress: hit.addressable_id,
              trackTitle: hit.title,
              trackArtist: hit.artist,
              trackImage: hit.image_url || undefined,
              // Degradation story: other NIP-88 clients render this plain label
              label: o.label.trim() || `${hit.artist} — ${hit.title}`,
            }
          : o,
      ),
    );
    setTrackSearchIdx(null);
  }, []);

  const detachTrack = useCallback((idx: number) => {
    setOptions((prev) =>
      prev.map((o, i) =>
        i === idx
          ? { id: o.id, label: o.label }
          : o,
      ),
    );
  }, []);

  const filledOptions = options.filter((o) => o.label.trim().length > 0);
  const labels = filledOptions.map((o) => o.label.trim().toLowerCase());
  const hasDuplicates = new Set(labels).size !== labels.length;
  const canSubmit =
    question.trim().length > 0 && filledOptions.length >= 2 && !hasDuplicates;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const seconds = DURATIONS[durationIdx].seconds;
    onSubmit({
      question: question.trim(),
      options: filledOptions.map((o) => ({
        id: o.id,
        label: o.label.trim(),
        trackAddress: o.trackAddress,
      })),
      pollType: multi ? "multiplechoice" : "singlechoice",
      endsAt: seconds ? Math.floor(Date.now() / 1000) + seconds : undefined,
    });
  };

  return (
    // Caps to the popover's offered space (CSS vars, full-size fallback when
    // standalone) and scrolls as a whole on short viewports; the options list
    // also has its own inner scroll for the common case.
    <div className="w-[min(460px,var(--popover-max-w,calc(100vw-24px)))] max-h-[var(--popover-max-h,90vh)] overflow-y-auto rounded-xl border border-border bg-panel p-4 shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        <BarChart3 size={13} className="text-primary-soft" />
        <span>Create poll</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      {/* Question */}
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask a question..."
        rows={2}
        autoFocus
        className="mt-3 w-full resize-none rounded-lg bg-field px-3.5 py-2.5 text-sm text-heading placeholder:text-muted ring-1 ring-border focus:outline-none focus:ring-primary/40"
      />

      {/* Options — the scroll container's overflow clips on BOTH axes (CSS forces
          overflow-x to auto when overflow-y isn't visible). The -mx-1 px-1 gutter
          keeps the left/right rings, and py-1 keeps the first/last option's
          top/bottom rings; mt-2 + the 4px top padding restores the ~12px gap. */}
      <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto -mx-1 px-1 py-1">
        {options.map((option, idx) => (
          <div key={option.id}>
            <div className="flex items-center gap-2">
              <input
                value={option.label}
                onChange={(e) => setOptionLabel(idx, e.target.value)}
                placeholder={`Option ${idx + 1}`}
                maxLength={120}
                className="min-w-0 flex-1 rounded-lg bg-field px-3.5 py-2 text-sm text-heading placeholder:text-muted ring-1 ring-border focus:outline-none focus:ring-primary/40"
              />
              {allowMusicOptions && !option.trackAddress && (
                <button
                  type="button"
                  onClick={() => setTrackSearchIdx(trackSearchIdx === idx ? null : idx)}
                  className={`shrink-0 rounded-lg p-2 transition-colors ${
                    trackSearchIdx === idx
                      ? "bg-primary/20 text-primary"
                      : "text-muted hover:text-heading hover:bg-surface-hover"
                  }`}
                  title="Attach a track"
                >
                  <Music size={15} />
                </button>
              )}
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  className="shrink-0 rounded-lg p-2 text-muted hover:text-red-400 hover:bg-surface-hover transition-colors"
                  title="Remove option"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Attached track chip */}
            {option.trackAddress && (
              <div className="mt-1.5 flex items-center gap-2.5 rounded-lg border border-border bg-field/60 px-2.5 py-1.5">
                {option.trackImage ? (
                  <img src={option.trackImage} alt="" className="h-7 w-7 rounded object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-card">
                    <Music size={12} className="text-muted" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-soft">
                  {option.trackTitle}
                  {option.trackArtist ? ` · ${option.trackArtist}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => detachTrack(idx)}
                  className="shrink-0 rounded p-1 text-muted hover:text-red-400 transition-colors"
                  title="Remove track"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Inline search — expands in flow, never overlaps other inputs */}
            {trackSearchIdx === idx && (
              <TrackSearchPanel
                onSelect={(hit) => attachTrack(idx, hit)}
                onClose={() => setTrackSearchIdx(null)}
              />
            )}
          </div>
        ))}
      </div>

      {options.length < MAX_OPTIONS && (
        <button
          type="button"
          onClick={addOption}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted hover:text-heading hover:border-border-light transition-colors"
        >
          <Plus size={13} />
          Add option
        </button>
      )}

      {hasDuplicates && (
        <p className="mt-2 text-[11px] text-red-400">Options must be unique.</p>
      )}

      {/* Settings + actions */}
      <div className="mt-3.5 space-y-2.5 border-t border-border pt-3">
        {/* Poll length */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="text-xs text-muted">Poll length</span>
          <div className="flex items-center gap-1 rounded-lg bg-field p-1 ring-1 ring-border">
            {DURATIONS.map((d, i) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDurationIdx(i)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  durationIdx === i
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-muted hover:text-heading"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Multiple-choice toggle shares the action row */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMulti((prev) => !prev)}
            className="flex items-center gap-2 text-xs text-muted hover:text-heading transition-colors"
            title="Allow choosing several options"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                multi ? "border-primary bg-primary text-white" : "border-border-light"
              }`}
            >
              {multi && <Check size={10} strokeWidth={4} />}
            </span>
            Multiple choice
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-xs text-muted hover:text-heading transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="rounded-lg bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
            >
              Create poll
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
