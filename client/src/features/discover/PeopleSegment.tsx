import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UsersRound, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addNotification } from "@/store/slices/notificationSlice";
import { searchPeople, type PersonHit } from "@/lib/api/people";
import { profileCache } from "@/lib/nostr/profileCache";
import { followUser, unfollowUser } from "@/lib/nostr/follow";
import { removeFriendAction, wouldBreakFriendship } from "@/lib/nostr/friendRequest";
import { useUserSearch } from "@/features/search/useUserSearch";
import { useClickOutside } from "@/hooks/useClickOutside";
import { fromHit, fromLocal, type PersonRowData } from "./peopleRow";
import { PersonRow } from "./components/PersonRow";
import { SectionHeader } from "./components/SectionHeader";
import { RowSkeleton } from "./components/Skeletons";

const PEOPLE_LIMIT = 30;
const DEBOUNCE_MS = 300;

/**
 * People: server-ranked handles to browse, hybrid search when typing. The
 * index cannot resolve an npub, so the local hybrid search (npub paste,
 * NIP-50 relay search) stays on for queries and covers profiles the backend
 * has not indexed.
 */
export function PeopleSegment({ query }: { query: string }) {
  const navigate = useNavigate();
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  const local = useUserSearch();
  const { setQuery: setLocalQuery } = local;
  useEffect(() => {
    setLocalQuery(trimmed);
  }, [trimmed, setLocalQuery]);

  const [people, setPeople] = useState<PersonHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    const run = () => {
      // Browse asks for verified handles only; search does not, because
      // filtering a name someone typed to verified-only hides real answers.
      searchPeople(
        hasQuery ? { q: trimmed, limit: PEOPLE_LIMIT } : { hasNip05: true, limit: PEOPLE_LIMIT },
      )
        .then(({ data }) => {
          if (seq !== seqRef.current) return;
          setPeople(data);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setPeople([]);
          setLoading(false);
        });
    };
    // Debounce typing; browse fires immediately.
    if (!hasQuery) {
      run();
      return;
    }
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hasQuery, trimmed]);

  // Names/avatars come from the index, but hydrating kind-0s makes the profile
  // page warm on click-through — the same batched backfill the rest of the
  // app uses.
  useEffect(() => {
    const pubkeys = (people ?? []).map((p) => p.pubkey);
    if (pubkeys.length > 0) profileCache.warmPubkeys(pubkeys);
  }, [people]);

  const rows = useMemo<PersonRowData[]>(() => {
    const out = (people ?? []).map(fromHit);
    if (!hasQuery) return out;
    // Merge in anything only the local/relay path found (npub paste, or a
    // profile the backend has not indexed), server rows first.
    const seen = new Set(out.map((r) => r.pubkey));
    for (const result of local.results) {
      if (!seen.has(result.pubkey)) {
        seen.add(result.pubkey);
        out.push(fromLocal(result));
      }
    }
    return out;
  }, [people, local.results, hasQuery]);

  const openProfile = useCallback(
    (pubkey: string) => {
      navigate(`/profile/${pubkey}`);
    },
    [navigate],
  );

  const busy = loading || (hasQuery && local.isSearching);

  if (busy && rows.length === 0) {
    return <RowSkeleton count={5} />;
  }

  if (rows.length === 0) {
    return hasQuery ? (
      <EmptyState
        icon={<SearchX size={24} className="mb-2 text-muted opacity-30" />}
        title="No one found"
        message="Try a different name, or paste an npub directly."
      />
    ) : (
      <EmptyState
        icon={<UsersRound size={24} className="mb-2 text-muted opacity-30" />}
        title="No one to show yet"
        message="People show up here once they set a nip05 handle on their key."
      />
    );
  }

  return (
    <section className="@container">
      {/* Says what the list IS, not just what it contains — the browse list is
          handles-only, and a surface that ranks owes the reader that. */}
      {!hasQuery && <SectionHeader title="With handles" />}
      <div className="grid grid-cols-1 gap-x-8 @3xl:grid-cols-2">
        {rows.map((person) => (
          <PersonRow
            key={person.pubkey}
            person={person}
            mixed={hasQuery}
            onOpen={openProfile}
            action={<QuietFollowButton pubkey={person.pubkey} />}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Text-only follow control for list rows. A column of primary buttons would
 * shout; a word in the reporting column states the relationship. Unfollow
 * confirms when it would also break a friendship (as the profile page does).
 */
export function QuietFollowButton({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isFollowing = useAppSelector((s) => s.identity.followList.includes(pubkey));
  const followListLoaded = useAppSelector((s) => s.identity.followListCreatedAt > 0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  useClickOutside(confirmRef, () => setConfirming(false), confirming);

  if (!myPubkey || myPubkey === pubkey) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      dispatch(
        addNotification({
          id: `follow-error-${Date.now()}`,
          type: "follow",
          title: "Follow failed",
          body: "Your contact list is still loading. Please wait a moment and try again.",
          timestamp: Date.now(),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    if (isFollowing) {
      if (wouldBreakFriendship(pubkey)) {
        setConfirming(true);
        return;
      }
      void run(() => unfollowUser(pubkey));
    } else {
      void run(() => followUser(pubkey));
    }
  };

  return (
    <div ref={confirmRef} className="relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !followListLoaded}
        aria-pressed={isFollowing}
        className={cn(
          "px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-40",
          isFollowing ? "text-faint hover:text-soft" : "text-soft hover:text-heading",
        )}
      >
        {isFollowing ? "Following" : "Follow"}
      </button>
      {confirming && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-border p-3 shadow-lg"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <p className="mb-2 text-[11px] font-medium text-heading">
            Unfollowing will also remove them as a friend.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 text-[10px] text-soft hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                void run(() => removeFriendAction(pubkey));
              }}
              className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/30"
            >
              Unfollow &amp; Unfriend
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <p className="text-xs font-medium text-heading">{title}</p>
      <p className="mt-1 text-xs text-faint">{message}</p>
    </div>
  );
}
