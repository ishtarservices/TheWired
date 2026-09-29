import { useState } from "react";
import { Upload, Disc3, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import { UploadTrackModal } from "./UploadTrackModal";
import { CreateAlbumModal } from "./CreateAlbumModal";

/**
 * What an empty music library says instead of a shrug. The two ways to put
 * something here — a single track, or a project that groups tracks — are two
 * different modals, so the screen presents them as two doors side by side and
 * owns both modals itself. Signed-out viewers only get the explore door.
 *
 * `variant="banner"` is the same invitation folded into a strip, for a home
 * that has trending content to show but nothing of the viewer's own yet.
 */
export function MusicGetStarted({ variant = "page" }: { variant?: "page" | "banner" }) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const explore = () => dispatch(setMusicView("explore"));

  const modals = pubkey ? (
    <>
      <UploadTrackModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CreateAlbumModal open={projectOpen} onClose={() => setProjectOpen(false)} />
    </>
  ) : null;

  if (variant === "banner") {
    return (
      <section
        aria-label="Get started with music"
        className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">Nothing of yours here yet</p>
          <p className="text-xs text-soft">
            Upload a track or start a project, and it shows up across your spaces.
          </p>
        </div>
        {pubkey ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setProjectOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:border-border-light hover:text-heading press-effect"
            >
              <Disc3 size={14} />
              Start a project
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-soft px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 press-effect"
            >
              <Upload size={14} />
              Upload a track
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">Sign in to upload.</p>
        )}
        {modals}
      </section>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl text-center">
        {pubkey ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <DoorCard
              icon={<Upload size={22} />}
              title="Upload a track"
              body="Drop in an audio file, add a cover and genre, and decide who can hear it."
              primary
              onClick={() => setUploadOpen(true)}
            />
            <DoorCard
              icon={<Disc3 size={22} />}
              title="Start a project"
              body="An album or EP that holds your tracks, with collaborators and release notes."
              onClick={() => setProjectOpen(true)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">Sign in to upload your own music.</p>
        )}

        <button
          type="button"
          onClick={explore}
          className="mx-auto mt-6 flex items-center gap-1.5 text-sm text-soft transition-colors hover:text-heading"
        >
          <Compass size={15} />
          Browse what others are making
        </button>
        {modals}
      </div>
    </div>
  );
}

function DoorCard({
  icon,
  title,
  body,
  primary = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all hover-lift press-effect",
        primary
          ? "border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10"
          : "border-border bg-card hover:border-border-light hover:bg-card-hover",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl",
          primary
            ? "bg-gradient-to-br from-primary to-primary-soft text-white"
            : "bg-surface text-soft group-hover:text-heading",
        )}
      >
        {icon}
      </span>
      <span className="text-base font-semibold text-heading">{title}</span>
      <span className="text-sm leading-relaxed text-soft">{body}</span>
    </button>
  );
}
