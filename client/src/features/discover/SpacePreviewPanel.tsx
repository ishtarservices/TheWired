import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Info, Rss, Users, AlertCircle } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { setChannels, setActiveChannel } from "@/store/slices/spacesSlice";
import { useSpace } from "@/features/spaces/useSpace";
import { switchSpaceChannel } from "@/lib/nostr/groupSubscriptions";
import { joinSpaceApi } from "@/lib/api/spaces";
import { BOOTSTRAP_RELAYS } from "@/lib/nostr/constants";
import type { Space, SpaceChannel } from "@/types/space";
import { spaceSignalLabel } from "./ranking";
import { SignalLine } from "./components/SignalLine";

/**
 * Right-panel preview for the space selected on /discover. Reads the selection
 * from `ui.discoverPreviewSpace` (set by the ranked rows) and carries the join
 * flow that used to live in the Discover page's modal.
 */
export function SpacePreviewPanel() {
  const space = useAppSelector((s) => s.ui.discoverPreviewSpace);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { joinSpace, selectSpace } = useSpace();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const mySpaces = useAppSelector((s) => s.spaces.list);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyJoined = space ? mySpaces.some((s) => s.id === space.id) : false;

  const handleJoin = async () => {
    if (!space || !myPubkey) return;

    setJoining(true);
    setError(null);

    try {
      const res = await joinSpaceApi(space.id);
      const { space: spaceData, channels, feedPubkeys } = res.data;

      // Store channels in Redux BEFORE joinSpace so they're available
      // Normalize channels to ensure feedMode is present (backward compat)
      const normalizedChannels: SpaceChannel[] = channels.map((ch: any) => ({
        ...ch,
        feedMode: ch.feedMode ?? "all",
      }));
      dispatch(setChannels({ spaceId: space.id, channels: normalizedChannels }));

      const spaceMode = (spaceData.mode as "read" | "read-write") ?? "read-write";

      // Build the full space object with feed sources included
      const spaceObj: Space = {
        id: space.id,
        name: spaceData.name,
        about: spaceData.about ?? undefined,
        picture: spaceData.picture ?? undefined,
        mode: spaceMode,
        creatorPubkey: spaceData.creatorPubkey ?? "",
        adminPubkeys: spaceData.creatorPubkey ? [spaceData.creatorPubkey] : [],
        memberPubkeys: [myPubkey],
        feedPubkeys: feedPubkeys ?? [],
        hostRelay: spaceData.hostRelay || BOOTSTRAP_RELAYS[0],
        isPrivate: false,
        createdAt: Math.floor(Date.now() / 1000),
      };

      // joinSpace adds space to Redux + IndexedDB, sets it active, enters
      // subscriptions. But it can't find channels (stale closure), so we
      // manually select the default channel afterward.
      joinSpace(spaceObj);

      // Manually pick the default channel and create the Nostr subscription
      // since joinSpace's allChannels closure is stale.
      if (normalizedChannels.length > 0) {
        const visible = spaceMode === "read"
          ? normalizedChannels.filter((c: SpaceChannel) => c.type !== "chat")
          : normalizedChannels;
        const sorted = [...visible].sort((a: SpaceChannel, b: SpaceChannel) => a.position - b.position);
        const best = sorted.find((c: SpaceChannel) => c.isDefault) ?? sorted[0];
        if (best) {
          const channelId = `${space.id}:${best.id}`;
          dispatch(setActiveChannel(channelId));
          switchSpaceChannel(spaceObj, best.type, best.id);
        }
      }

      dispatch(setSidebarMode("spaces"));
      navigate("/");
    } catch (err: any) {
      if (err?.code === "ALREADY_MEMBER") {
        setError("You're already a member of this space.");
      } else if (err?.status === 401) {
        setError("Please sign in to join spaces.");
      } else {
        setError(err?.message ?? "Failed to join space. Please try again.");
      }
    } finally {
      setJoining(false);
    }
  };

  const handleGoToSpace = () => {
    if (!space) return;
    // Actually select the space — before, this landed on whatever space was
    // last active.
    selectSpace(space.id);
    dispatch(setSidebarMode("spaces"));
    navigate("/");
  };

  // Reset error when space changes
  useEffect(() => {
    setError(null);
  }, [space?.id]);

  if (!space) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <Info size={24} className="text-muted opacity-30 mb-2" />
        <p className="text-xs text-muted">Select a space to preview it</p>
      </div>
    );
  }

  const isReadOnly = space.mode === "read";
  const signal = spaceSignalLabel(space);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="space-preview-panel">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar src={space.picture} alt={space.name} size="lg" className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-heading truncate">{space.name}</h2>
            {isReadOnly && (
              <span className="shrink-0 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Rss size={9} />
                Feed
              </span>
            )}
          </div>
          {space.category && (
            <p className="text-[11px] text-muted capitalize mt-0.5">
              {space.category.replace(/-/g, " ")}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {space.about && (
        <p className="text-xs text-soft leading-relaxed">{space.about}</p>
      )}

      {/* Meta: member count + the same why-line the ranked row prints */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1 font-mono tabular-nums">
          <Users size={11} />
          {space.memberCount} member{space.memberCount !== 1 ? "s" : ""}
        </span>
        {isReadOnly && (
          <span className="flex items-center gap-1 text-primary/70">
            <Rss size={11} />
            Read-only feed
          </span>
        )}
        <SignalLine label={signal} />
      </div>

      {/* Tags */}
      {space.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {space.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-card border border-border px-2 py-0.5 text-[10px] text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Action */}
      <div className="flex">
        {alreadyJoined ? (
          <Button variant="secondary" size="md" className="w-full" onClick={handleGoToSpace}>
            Go to Space
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={handleJoin}
            disabled={joining || !myPubkey}
          >
            {joining ? <Spinner size="sm" /> : "Join Space"}
          </Button>
        )}
      </div>
    </div>
  );
}
