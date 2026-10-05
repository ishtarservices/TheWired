import { useMemo } from "react";
import { Disc3, Inbox, Lock, Music, RefreshCw, Users } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { Spinner } from "@/components/ui/Spinner";
import { ListenRequestRow } from "../ListenRequestRow";
import { groupByRelease, type ListenRequestRelease } from "../listenRequestInbox";
import { parseListenTarget } from "../listenRequestWire";
import { getTrackImage } from "../trackImage";
import { useIncomingListenRequests } from "../useListenRequests";

/** The owner's listen-request inbox, grouped by release. */
export function ListenRequests() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { groups, loading, error, refresh } = useIncomingListenRequests();
  const releases = useMemo(() => groupByRelease(groups), [groups]);

  if (!pubkey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Sign in to see listen requests</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">Listen Requests</h2>
        {groups.length > 0 && <span className="text-sm text-muted">{groups.length}</span>}
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:border-border-light hover:text-heading press-effect disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
          Refresh
        </button>
      </div>
      <p className="mb-4 text-xs text-muted">
        People asking to hear your private releases. Granting adds them as a viewer: they can play it, nothing else.
      </p>

      {error && (
        <p className="mb-3 text-xs text-red-400">
          {error}{" "}
          <button onClick={refresh} className="underline hover:text-red-300">
            Try again
          </button>
        </p>
      )}

      {releases.length === 0 ? (
        loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox size={40} className="mb-3 text-muted" />
            <p className="text-sm text-soft">No listen requests</p>
            <p className="mt-1 max-w-xs text-xs text-muted">
              When someone asks to hear one of your private releases, it shows up here.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {releases.map((release) => (
            <ReleaseRequests key={release.targetRef} release={release} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReleaseRequests({ release }: { release: ListenRequestRelease }) {
  const dispatch = useAppDispatch();
  const target = parseListenTarget(release.targetRef);
  const isTrack = target?.kind === 31683;
  const track = useAppSelector((s) => (isTrack ? s.music.tracks[release.targetRef] : undefined));
  const album = useAppSelector((s) => (!isTrack ? s.music.albums[release.targetRef] : undefined));
  const albums = useAppSelector((s) => s.music.albums);

  const title = track?.title ?? album?.title ?? target?.d ?? release.targetRef;
  const image = track ? getTrackImage(track, albums) : album?.imageUrl;
  const visibility = track?.visibility ?? album?.visibility;
  const albumTarget = isTrack ? track?.albumRef : release.targetRef;

  return (
    <section className="rounded-xl border border-border card-glass p-2">
      <button
        type="button"
        disabled={!albumTarget}
        onClick={() => albumTarget && dispatch(setActiveDetailId({ view: "album-detail", id: albumTarget }))}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-surface disabled:cursor-default"
      >
        {image ? (
          <img src={image} alt={title} className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
            {isTrack ? <Music size={16} className="text-muted" /> : <Disc3 size={16} className="text-muted" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-heading">{title}</p>
          <p className="flex items-center gap-1 text-xs text-soft">
            {isTrack ? "Track" : "Project"}
            {visibility === "private" && (
              <>
                <span>·</span>
                <Lock size={10} /> Private
              </>
            )}
            {visibility === "space" && (
              <>
                <span>·</span>
                <Users size={10} /> Space
              </>
            )}
          </p>
        </div>
        <span className="text-xs text-muted">
          {release.groups.length} {release.groups.length === 1 ? "request" : "requests"}
        </span>
      </button>
      <div className="mt-1">
        {release.groups.map((g) => (
          <ListenRequestRow key={g.key} group={g} />
        ))}
      </div>
    </section>
  );
}
