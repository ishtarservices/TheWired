import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, GitPullRequest, Plus } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMusicView, setActiveDetailId, setProposals } from "@/store/slices/musicSlice";
import { ProposalCard } from "../ProposalCard";
import { CreateProposalModal } from "../CreateProposalModal";
import type { MusicProposal } from "@/types/music";
import { getApiBaseUrl } from "@/lib/api/client";
import { buildNip98Header } from "@/lib/api/nip98";

export function ProjectProposals() {
  const dispatch = useAppDispatch();
  const albumId = useAppSelector((s) => s.music.activeDetailId);
  const album = useAppSelector((s) =>
    albumId ? s.music.albums[albumId] : undefined,
  );
  const proposals = useAppSelector((s) =>
    albumId ? s.music.proposals[albumId] ?? [] : [],
  );
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const isOwner = pubkey === album?.pubkey;
  const isCollaborator = !!pubkey && !!album && album.featuredArtists.includes(pubkey);

  const fetchProposals = useCallback(async () => {
    if (!album) return;
    const [, albumPubkey, ...slugParts] = album.addressableId.split(":");
    const slug = slugParts.join(":");
    if (!albumPubkey || !slug) return;

    setLoading(true);
    try {
      const url = `${getApiBaseUrl()}/music/proposals/${albumPubkey}/${encodeURIComponent(slug)}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const data = (json.data ?? []) as MusicProposal[];
        dispatch(setProposals({ albumId: album.addressableId, proposals: data }));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [album, dispatch]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleResolve = async (proposalId: string, status: "accepted" | "rejected") => {
    try {
      const url = `${getApiBaseUrl()}/music/proposals/${proposalId}/resolve`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: await buildNip98Header(url, "POST"),
      };
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await fetchProposals();
      }
    } catch {
      // ignore
    }
  };

  if (!album) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Album not found</p>
      </div>
    );
  }

  const openProposals = proposals.filter((p) => p.status === "open");
  const resolvedProposals = proposals.filter((p) => p.status !== "open");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-edge px-6 py-4">
        <button
          onClick={() =>
            albumId
              ? dispatch(setActiveDetailId({ view: "album-detail", id: albumId }))
              : dispatch(setMusicView("home"))
          }
          className="rounded p-1 text-soft hover:text-heading"
        >
          <ArrowLeft size={20} />
        </button>
        <GitPullRequest size={20} className="text-pulse" />
        <div>
          <h1 className="text-lg font-bold text-heading">Proposals</h1>
          <p className="text-xs text-soft">
            {album.title} &middot; {proposals.length} proposal{proposals.length !== 1 ? "s" : ""}
          </p>
        </div>
        {(isOwner || isCollaborator) && (
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pulse to-pulse-soft px-4 py-1.5 text-sm font-medium text-white transition-transform hover:scale-105 press-effect"
          >
            <Plus size={14} />
            New Proposal
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
          </div>
        ) : proposals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <GitPullRequest size={40} className="mb-3 text-muted" />
            <p className="text-sm text-soft">No proposals yet</p>
            <p className="mt-1 text-xs text-muted">
              Collaborators can propose changes to this project
            </p>
          </div>
        ) : (
          <>
            {openProposals.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  Open ({openProposals.length})
                </h2>
                <div className="space-y-3">
                  {openProposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      isOwner={isOwner}
                      onAccept={() => handleResolve(p.id, "accepted")}
                      onReject={() => handleResolve(p.id, "rejected")}
                    />
                  ))}
                </div>
              </div>
            )}

            {resolvedProposals.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  Resolved ({resolvedProposals.length})
                </h2>
                <div className="space-y-3">
                  {resolvedProposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      isOwner={isOwner}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateProposalModal
          album={album}
          onClose={() => {
            setShowCreate(false);
            fetchProposals();
          }}
        />
      )}
    </div>
  );
}
