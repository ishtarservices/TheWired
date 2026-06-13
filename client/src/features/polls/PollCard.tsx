import { useMemo, useState, useCallback } from "react";
import { BarChart3, Check, Clock, Loader2 } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { tallyPoll } from "../../store/slices/pollsSlice";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { parsePollEvent, type PollOption } from "./pollParser";
import { useVote, usePollRelays } from "./useVote";
import { usePollCountdown } from "./usePollCountdown";
import { usePollVotesSub } from "./usePollVotesSub";
import { PollTrackChip } from "./PollTrackChip";
import type { NostrEvent } from "../../types/nostr";

/** Foreign polls may carry arbitrarily many options; render this many before
 *  the "+N more" expander (our composer caps at 10). */
const VISIBLE_OPTIONS_CAP = 20;

interface PollCardProps {
  event: NostrEvent;
  variant: "chat" | "feed" | "embed";
  /** Results-only, non-interactive (deep embeds) */
  compact?: boolean;
}

/**
 * NIP-88 poll card. Tallies are hidden until the viewer has voted or the poll
 * ended ("View results" reveals them early); voting is one vote per pubkey
 * with change-vote = re-cast (latest wins). In spaces, the tally counts
 * members only by default, with a toggle to include outside votes.
 */
export function PollCard({ event, variant, compact = false }: PollCardProps) {
  const poll = useMemo(() => parsePollEvent(event), [event]);

  // Chat batches one #e sub for all visible polls (ChatView); feed/embed
  // cards fetch their own votes so shared polls tally anywhere.
  const selfSubIds = useMemo(
    () => (variant === "chat" || compact ? [] : [poll.id]),
    [variant, compact, poll.id],
  );
  const relays = usePollRelays(poll);
  const subRelays = useMemo(() => (relays.length ? relays : undefined), [relays]);
  usePollVotesSub(selfSubIds, subRelays);

  const votesMap = useAppSelector((s) => s.polls.byPoll[poll.id]);
  const memberPubkeys = useAppSelector((s) =>
    poll.spaceId
      ? s.spaces.list.find((sp) => sp.id === poll.spaceId)?.memberPubkeys
      : undefined,
  );

  const { ended, label: countdownLabel } = usePollCountdown(poll.endsAt);
  const { myVote, castVote, isVoting, canVote } = useVote(poll);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [editingVote, setEditingVote] = useState(false);
  const [revealResults, setRevealResults] = useState(false);
  const [includeNonMembers, setIncludeNonMembers] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);

  const memberSet = useMemo(
    () => (memberPubkeys?.length ? new Set(memberPubkeys) : undefined),
    [memberPubkeys],
  );

  const tally = useMemo(
    () => tallyPoll(votesMap, poll, includeNonMembers ? undefined : memberSet),
    [votesMap, poll, includeNonMembers, memberSet],
  );

  const isMulti = poll.pollType === "multiplechoice";
  const showResults = compact || ended || (!!myVote && !editingVote) || revealResults;
  const interactive = !compact && canVote && !showResults;

  const submitVote = useCallback(
    async (optionIds: string[]) => {
      try {
        await castVote(optionIds);
        setEditingVote(false);
        setSelection(new Set());
        setRevealResults(false);
      } catch (err) {
        console.error("[polls] vote failed", err);
      }
    },
    [castVote],
  );

  const handleOptionClick = useCallback(
    (option: PollOption) => {
      if (!interactive || isVoting) return;
      if (isMulti) {
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(option.id)) next.delete(option.id);
          else next.add(option.id);
          return next;
        });
      } else {
        void submitVote([option.id]);
      }
    },
    [interactive, isVoting, isMulti, submitVote],
  );

  const startChangeVote = useCallback(() => {
    setSelection(new Set(myVote?.optionIds ?? []));
    setEditingVote(true);
    setRevealResults(false);
  }, [myVote]);

  const visibleOptions = showAllOptions
    ? poll.options
    : poll.options.slice(0, VISIBLE_OPTIONS_CAP);
  const hiddenCount = poll.options.length - visibleOptions.length;

  return (
    <div
      className={`rounded-xl border border-border card-glass px-4 py-3 ${
        variant === "chat" ? "mt-1 max-w-md" : "w-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <BarChart3 size={12} className="text-primary-soft" />
        <span>Poll</span>
        {isMulti && <span className="text-faint">· Multiple choice</span>}
        {countdownLabel && (
          <span className={`ml-auto flex items-center gap-1 normal-case tracking-normal ${ended ? "text-faint" : "text-soft"}`}>
            <Clock size={11} />
            {ended ? "Final results" : countdownLabel}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-sm font-semibold text-heading break-words">
        {poll.question}
      </p>

      {/* Options */}
      <div className={`mt-3 space-y-1.5 ${isVoting ? "pointer-events-none opacity-70" : ""}`}>
        {visibleOptions.map((option) => (
          <PollOptionRow
            key={option.id}
            option={option}
            interactive={interactive}
            isMulti={isMulti}
            selected={selection.has(option.id)}
            showResults={showResults}
            count={tally.byOption[option.id] ?? 0}
            totalVoters={tally.totalVoters}
            isWinner={ended && tally.winnerOptionIds.includes(option.id)}
            isMyPick={!!myVote?.optionIds.includes(option.id)}
            voters={tally.votersByOption[option.id] ?? []}
            onClick={() => handleOptionClick(option)}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAllOptions(true)}
            className="w-full rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:text-heading hover:border-border-light transition-colors"
          >
            +{hiddenCount} more {hiddenCount === 1 ? "option" : "options"}
          </button>
        )}
      </div>

      {/* Multi-choice submit */}
      {interactive && isMulti && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            disabled={selection.size === 0 || isVoting}
            onClick={() => void submitVote([...selection])}
            className="rounded-lg bg-gradient-to-r from-primary to-primary-soft px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
          >
            Vote{selection.size > 0 ? ` (${selection.size})` : ""}
          </button>
          {editingVote && (
            <button
              type="button"
              onClick={() => setEditingVote(false)}
              className="text-xs text-muted hover:text-heading transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {tally.totalVoters} {tally.totalVoters === 1 ? "vote" : "votes"}
        </span>
        {isVoting && <Loader2 size={12} className="animate-spin text-primary-soft" />}

        {!compact && !showResults && !isVoting && (
          <button
            type="button"
            onClick={() => setRevealResults(true)}
            className="hover:text-heading transition-colors"
          >
            View results
          </button>
        )}
        {!compact && revealResults && !myVote && !ended && (
          <button
            type="button"
            onClick={() => setRevealResults(false)}
            className="hover:text-heading transition-colors"
          >
            Back to voting
          </button>
        )}
        {!compact && myVote && !ended && !editingVote && (
          <button
            type="button"
            onClick={startChangeVote}
            className="hover:text-heading transition-colors"
          >
            Change vote
          </button>
        )}
        {editingVote && !isMulti && (
          <button
            type="button"
            onClick={() => setEditingVote(false)}
            className="hover:text-heading transition-colors"
          >
            Cancel
          </button>
        )}
        {!canVote && !ended && !compact && (
          <span className="text-faint">Log in to vote</span>
        )}

        {/* Members-only tally toggle (space polls) */}
        {memberSet && (includeNonMembers || tally.excludedNonMembers > 0) && (
          <button
            type="button"
            onClick={() => setIncludeNonMembers((prev) => !prev)}
            className="ml-auto text-faint hover:text-heading transition-colors"
            title={
              includeNonMembers
                ? "Count votes from space members only"
                : "Include votes from outside this space"
            }
          >
            {includeNonMembers
              ? "All votes · show members only"
              : `+${tally.excludedNonMembers} from outside the space`}
          </button>
        )}
      </div>
    </div>
  );
}

interface PollOptionRowProps {
  option: PollOption;
  interactive: boolean;
  isMulti: boolean;
  selected: boolean;
  showResults: boolean;
  count: number;
  totalVoters: number;
  isWinner: boolean;
  isMyPick: boolean;
  voters: string[];
  onClick: () => void;
}

function PollOptionRow({
  option,
  interactive,
  isMulti,
  selected,
  showResults,
  count,
  totalVoters,
  isWinner,
  isMyPick,
  voters,
  onClick,
}: PollOptionRowProps) {
  const pct = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;

  // div-with-role instead of <button>: track chips nest their own play button
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`relative overflow-hidden rounded-lg border px-3 py-2 transition-colors ${
        showResults
          ? isWinner
            ? "border-primary/40"
            : "border-border"
          : selected
            ? "border-primary/50 bg-primary/[0.08] cursor-pointer"
            : interactive
              ? "border-border bg-field/40 cursor-pointer hover:border-primary/30 hover:bg-surface-hover"
              : "border-border bg-field/40"
      }`}
    >
      {/* Result bar */}
      {showResults && (
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
            isWinner ? "bg-primary/20" : "bg-primary/10"
          }`}
          style={{ width: `${pct}%` }}
        />
      )}

      <div className="relative flex items-center gap-2.5">
        {/* Select affordance */}
        {!showResults && (
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
              isMulti ? "rounded" : "rounded-full"
            } ${
              selected
                ? "border-primary bg-primary text-white"
                : "border-border-light"
            }`}
          >
            {selected && <Check size={11} strokeWidth={3} />}
          </span>
        )}

        {/* Label / track chip */}
        {option.trackRef ? (
          <PollTrackChip trackRef={option.trackRef} fallbackLabel={option.label} />
        ) : (
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              isWinner ? "font-medium text-heading" : "text-body"
            }`}
          >
            {option.label || "—"}
          </span>
        )}

        {/* Results: my pick, voters, percentage */}
        {showResults && (
          <>
            {isMyPick && (
              <Check size={14} strokeWidth={3} className="shrink-0 text-primary" />
            )}
            <VoterAvatars pubkeys={voters} />
            <span className="shrink-0 text-xs font-semibold tabular-nums text-heading">
              {pct}%
            </span>
            <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted">
              {count}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function VoterAvatars({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {pubkeys.slice(0, 3).map((pk) => (
        <VoterAvatar key={pk} pubkey={pk} />
      ))}
    </span>
  );
}

function VoterAvatar({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  return <Avatar src={profile?.picture} alt="" size="xs" className="ring-2 ring-card" />;
}
