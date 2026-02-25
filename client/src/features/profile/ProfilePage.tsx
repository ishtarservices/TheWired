import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Globe, Zap, AtSign, ArrowLeft } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";
import { useProfile } from "./useProfile";
import { useProfileNotes } from "./useProfileNotes";
import { useFollowData } from "./useFollowData";
import { NoteCard } from "./NoteCard";
import { FollowCard } from "./FollowCard";
import type { NostrEvent } from "../../types/nostr";

type Tab = "notes" | "following" | "followers";

const PAGE_SIZE = 50;

interface ProfilePageProps {
  pubkey: string;
}

export function ProfilePage({ pubkey }: ProfilePageProps) {
  const { profile } = useProfile(pubkey);
  const [activeTab, setActiveTab] = useState<Tab>("notes");
  const { notes, loading: notesLoading, eoseReceived } = useProfileNotes(pubkey);
  const { following, followers, followingLoading, followersLoading } = useFollowData(pubkey, activeTab);
  const navigate = useNavigate();

  if (!profile) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  const tabs: { id: Tab; label: string; count: string }[] = [
    { id: "notes", label: "Notes", count: String(notes.length) },
    { id: "following", label: "Following", count: followingLoading ? "—" : String(following.length) },
    { id: "followers", label: "Followers", count: activeTab === "followers" || followers.length > 0 ? String(followers.length) : "—" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Banner */}
      <div className="relative h-40 bg-gradient-to-r from-pulse/60 to-neon/30">
        {profile?.banner && (
          <img
            src={profile.banner}
            alt="banner"
            className="h-full w-full object-cover"
          />
        )}
        <button
          onClick={() => navigate("/")}
          className="absolute left-3 top-3 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* Profile info */}
      <div className="relative px-6 pb-4">
        <div className="-mt-12 mb-4">
          <Avatar src={profile?.picture} alt={displayName} size="lg" className="h-24 w-24 border-4 border-backdrop" />
        </div>

        <h1 className="text-2xl font-bold text-heading">{displayName}</h1>

        {profile?.nip05 && (
          <div className="mt-1 flex items-center gap-1 text-sm text-neon">
            <AtSign size={14} />
            <span>{profile.nip05}</span>
          </div>
        )}

        {profile?.about && (
          <p className="mt-3 text-sm text-body">{profile.about}</p>
        )}

        <div className="mt-4 flex gap-4 text-sm text-soft">
          {profile?.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-neon transition-colors"
            >
              <Globe size={14} />
              <span>{profile.website}</span>
            </a>
          )}
          {profile?.lud16 && (
            <div className="flex items-center gap-1">
              <Zap size={14} />
              <span>{profile.lud16}</span>
            </div>
          )}
        </div>

        <div className="mt-2 text-xs text-muted">
          <User size={12} className="mr-1 inline" />
          {pubkey.slice(0, 16)}...
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 border-b border-edge px-6 pb-3 text-sm">
        <span className="text-soft">
          <span className="font-semibold text-heading">{notes.length}</span> Notes
        </span>
        <span className="text-soft">
          <span className="font-semibold text-heading">
            {followingLoading ? "—" : following.length}
          </span> Following
        </span>
        <span className="text-soft">
          <span className="font-semibold text-heading">
            {activeTab === "followers" || followers.length > 0 ? followers.length : "—"}
          </span> Followers
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-edge">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-neon text-neon"
                : "text-soft hover:text-heading"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 px-6 py-4">
        {activeTab === "notes" && (
          <NotesTab notes={notes} loading={notesLoading} eoseReceived={eoseReceived} />
        )}
        {activeTab === "following" && (
          <FollowTab pubkeys={following} loading={followingLoading} emptyText="Not following anyone" />
        )}
        {activeTab === "followers" && (
          <FollowTab pubkeys={followers} loading={followersLoading} emptyText="No followers yet" />
        )}
      </div>
    </div>
  );
}

function NotesTab({
  notes,
  loading,
  eoseReceived,
}: {
  notes: NostrEvent[];
  loading: boolean;
  eoseReceived: boolean;
}) {
  // Show full spinner only when we have no notes and are still loading
  if (loading && notes.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (notes.length === 0 && eoseReceived) {
    return (
      <p className="py-8 text-center text-sm text-muted">No notes yet</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notes.map((event) => (
        <NoteCard key={event.id} event={event} />
      ))}
      {!eoseReceived && (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}

function FollowTab({
  pubkeys,
  loading,
  emptyText,
}: {
  pubkeys: string[];
  loading: boolean;
  emptyText: string;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (loading && pubkeys.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (pubkeys.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
    );
  }

  const visible = pubkeys.slice(0, visibleCount);
  const hasMore = visibleCount < pubkeys.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((pk) => (
          <FollowCard key={pk} pubkey={pk} />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mx-auto mt-2 rounded-lg bg-surface px-4 py-2 text-sm text-soft transition-colors hover:bg-edge hover:text-heading"
        >
          Show more ({pubkeys.length - visibleCount} remaining)
        </button>
      )}
      {loading && (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
