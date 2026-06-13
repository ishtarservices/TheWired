import { useCallback, useMemo, useState } from "react";
import { X, Plus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Toggle } from "@/components/ui/Toggle";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useUnblock } from "@/hooks/useUnblock";
import {
  setShowReplies,
  setShowReposts,
  unhideAccount,
} from "@/store/slices/feedPrefsSlice";
import { setMuteList, type MuteEntry } from "@/store/slices/identitySlice";
import { persistCurrentFeedPrefs } from "./feedPrefsPersistence";
import { buildMuteListEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import {
  switchFriendsFeedChannel,
  refreshFriendsFeed,
} from "@/lib/nostr/groupSubscriptions";

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-t border-border px-4 pb-1 pt-2.5 text-xs font-medium uppercase tracking-wide text-muted">
      {title}
    </div>
  );
}

function AccountRow({
  pubkey,
  actionLabel,
  onAction,
  disabled,
}: {
  pubkey: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm text-body">{name}</span>
      <button
        onClick={onAction}
        disabled={disabled}
        className="rounded-md px-2 py-0.5 text-xs text-soft transition-colors hover:bg-card hover:text-heading disabled:opacity-50"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function MutedAccountRow({
  pubkey,
  disabled,
}: {
  pubkey: string;
  disabled: boolean;
}) {
  const unblock = useUnblock(pubkey);
  return (
    <AccountRow
      pubkey={pubkey}
      actionLabel="Unmute"
      onAction={unblock}
      disabled={disabled}
    />
  );
}

function HiddenAccountRow({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const onUnhide = useCallback(() => {
    dispatch(unhideAccount(pubkey));
    persistCurrentFeedPrefs();
  }, [dispatch, pubkey]);
  return <AccountRow pubkey={pubkey} actionLabel="Unhide" onAction={onUnhide} />;
}

export function FeedPrefsPanel({ channelType }: { channelType: string }) {
  const dispatch = useAppDispatch();
  const showReplies = useAppSelector((s) => s.feedPrefs.showReplies);
  const showReposts = useAppSelector((s) => s.feedPrefs.showReposts);
  const hiddenPubkeys = useAppSelector((s) => s.feedPrefs.hiddenPubkeys);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const muteListCreatedAt = useAppSelector((s) => s.identity.muteListCreatedAt);
  const profileChecked = useAppSelector((s) => s.identity.profileChecked);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const [wordInput, setWordInput] = useState("");

  const mutedPubkeys = useMemo(
    () => muteList.filter((m) => m.type === "pubkey").map((m) => m.value),
    [muteList],
  );
  const mutedWords = useMemo(
    () => muteList.filter((m) => m.type === "word").map((m) => m.value),
    [muteList],
  );

  // Wipe guard: kind:10000 is replaceable, so editing before the current list
  // is known would republish a partial list and nuke prior mutes. Ready once
  // the relay copy arrived, the IDB cache hydrated entries, or EOSE confirmed
  // none exists.
  const muteListReady =
    muteListCreatedAt > 0 || muteList.length > 0 || profileChecked;

  const handleRepliesChange = useCallback(
    (on: boolean) => {
      dispatch(setShowReplies(on));
      persistCurrentFeedPrefs();
    },
    [dispatch],
  );

  const handleRepostsChange = useCallback(
    (on: boolean) => {
      dispatch(setShowReposts(on));
      persistCurrentFeedPrefs();
      // Resubscribe the live notes sub with/without kind:6; backfill a full
      // page when enabling so existing reposts show without a manual refresh.
      if (channelType === "notes") {
        switchFriendsFeedChannel("notes");
        if (on) refreshFriendsFeed("notes", true);
      }
    },
    [dispatch, channelType],
  );

  const publishMutes = useCallback(
    async (next: MuteEntry[]) => {
      if (!myPubkey) return;
      const prev = muteList;
      const now = Math.floor(Date.now() / 1000);
      dispatch(setMuteList({ mutes: next, createdAt: now }));
      try {
        await signAndPublish(buildMuteListEvent(myPubkey, next));
      } catch {
        // Roll back the optimistic update (equal timestamp passes the guard)
        dispatch(setMuteList({ mutes: prev, createdAt: now }));
      }
    },
    [myPubkey, muteList, dispatch],
  );

  const addWord = useCallback(() => {
    const word = wordInput.trim();
    if (!word) return;
    setWordInput("");
    const exists = muteList.some(
      (m) => m.type === "word" && m.value.toLowerCase() === word.toLowerCase(),
    );
    if (exists) return;
    void publishMutes([...muteList, { type: "word", value: word }]);
  }, [wordInput, muteList, publishMutes]);

  const removeWord = useCallback(
    (value: string) => {
      void publishMutes(
        muteList.filter((m) => !(m.type === "word" && m.value === value)),
      );
    },
    [muteList, publishMutes],
  );

  return (
    <div className="w-80 overflow-hidden rounded-xl border border-border bg-panel shadow-xl">
      <div className="px-4 py-2.5 text-sm font-medium text-heading">
        Feed preferences
      </div>
      <div className="max-h-96 overflow-y-auto pb-3">
        <Toggle
          label="Show replies"
          description="Include replies from people you follow"
          checked={showReplies}
          onChange={handleRepliesChange}
        />
        <Toggle
          label="Show reposts"
          description="Include notes reposted by people you follow"
          checked={showReposts}
          onChange={handleRepostsChange}
        />

        <SectionHeader title="Muted words" />
        {mutedWords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {mutedWords.map((w) => (
              <span
                key={w}
                className="flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-xs text-body"
              >
                {w}
                <button
                  onClick={() => removeWord(w)}
                  disabled={!muteListReady}
                  className="text-muted transition-colors hover:text-red-400 disabled:opacity-50"
                  title={`Unmute "${w}"`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-4 pb-2 text-xs text-muted">
            Notes containing a muted word are hidden from your Feed.
          </p>
        )}
        <div className="flex items-center gap-1.5 px-4 pb-1">
          <input
            value={wordInput}
            onChange={(e) => setWordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWord();
              }
            }}
            placeholder="Mute a word or phrase"
            disabled={!muteListReady}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-heading placeholder:text-muted focus:border-border-light focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={addWord}
            disabled={!muteListReady || !wordInput.trim()}
            title="Add muted word"
            className="rounded-md border border-border p-1.5 text-soft transition-colors hover:bg-card hover:text-heading disabled:opacity-50"
          >
            <Plus size={13} />
          </button>
        </div>

        <SectionHeader title={`Muted accounts (${mutedPubkeys.length})`} />
        {mutedPubkeys.length === 0 ? (
          <p className="px-4 pb-1 text-xs text-muted">
            Muted accounts are hidden everywhere and synced to other Nostr
            clients.
          </p>
        ) : (
          mutedPubkeys.map((pk) => (
            <MutedAccountRow key={pk} pubkey={pk} disabled={!muteListReady} />
          ))
        )}

        <SectionHeader title={`Hidden accounts (${hiddenPubkeys.length})`} />
        <p className="px-4 pb-1 text-xs text-muted">
          Hidden only from your Feed on this device — nothing is published.
        </p>
        {hiddenPubkeys.map((pk) => (
          <HiddenAccountRow key={pk} pubkey={pk} />
        ))}
      </div>
    </div>
  );
}
