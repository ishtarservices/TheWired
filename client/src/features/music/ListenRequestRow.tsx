import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useProfile } from "@/features/profile/useProfile";
import { getDisplayName } from "@/features/dm/dmUtils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { ListenRequestGroup } from "./listenRequestInbox";
import { declineListenRequest, grantListenRequest } from "./listenRequests";
import { isKnownSpaceMember } from "./listenRequestActions";

/** One collapsed listen request: who asked, when, and Grant / Decline. */
export function ListenRequestRow({ group }: { group: ListenRequestGroup }) {
  const dispatch = useAppDispatch();
  const { profile } = useProfile(group.proposerPubkey);
  const name = getDisplayName(profile, group.proposerPubkey);
  const [busy, setBusy] = useState<"grant" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Space-exclusive releases can't be unlocked per person: the backend checks
  // space membership before p-tags, so only Decline is offered.
  const spaceExclusive = useAppSelector((s) => {
    const parsed = group.targetRef.startsWith("31683:")
      ? s.music.tracks[group.targetRef]
      : s.music.albums[group.targetRef];
    if (!parsed || parsed.visibility !== "space") return false;
    return !isKnownSpaceMember(s, parsed.spaceIds, group.proposerPubkey);
  });

  const run = async (kind: "grant" | "decline") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "grant") await dispatch(grantListenRequest(group));
      else await dispatch(declineListenRequest(group));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const age = formatDistanceToNow(new Date(group.createdAt * 1000), { addSuffix: true });

  return (
    <div className="rounded-lg px-3 py-2 transition-colors hover:bg-surface">
      <div className="flex items-center gap-3">
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-heading">
            <span className="font-medium">{name}</span>
            <span className="text-soft"> wants to listen</span>
          </p>
          <p className="truncate text-xs text-muted">
            {age}
            {group.rowIds.length > 1 && ` · asked ${group.rowIds.length} times`}
            {spaceExclusive && " · Space exclusive, they'd need to join the space"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!spaceExclusive && (
            <Button
              variant="accent"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run("grant")}
              title="Add them as a viewer. They can play it, nothing else."
            >
              {busy === "grant" ? "Granting..." : "Grant"}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run("decline")}>
            {busy === "decline" ? "Declining..." : "Decline"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-1 pl-11 text-xs text-red-400">{error}</p>}
    </div>
  );
}
