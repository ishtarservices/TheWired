import { X, RefreshCw } from "lucide-react";
import { useAppSelector } from "@/store/hooks";

interface ReleaseNotesModalProps {
  albumId: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function ReleaseNotesModal({ albumId, onClose, onUpdate }: ReleaseNotesModalProps) {
  const album = useAppSelector((s) => s.music.albums[albumId]);
  const savedVersion = useAppSelector((s) => s.music.savedVersions[albumId]);

  if (!album) return null;

  const savedDate = savedVersion
    ? new Date(savedVersion.savedCreatedAt * 1000).toLocaleDateString()
    : "Unknown";
  const currentDate = new Date(album.createdAt * 1000).toLocaleDateString();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60">
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border card-glass p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-muted hover:text-heading"
        >
          <X size={18} />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <RefreshCw size={20} className="text-primary" />
          <h2 className="text-lg font-bold text-heading">Update Available</h2>
        </div>

        <div className="mb-4 rounded-xl border border-border bg-surface/50 p-4">
          <h3 className="text-sm font-semibold text-heading">{album.title}</h3>
          <p className="mt-1 text-xs text-soft">{album.artist}</p>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Your saved version</span>
              <span className="text-soft">{savedDate}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Latest version</span>
              <span className="text-primary">{currentDate}</span>
            </div>
          </div>

          {album.revisionSummary && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                What changed
              </p>
              <p className="mt-1 text-xs text-body">{album.revisionSummary}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-soft hover:border-border-light hover:text-heading transition-colors"
          >
            Later
          </button>
          <button
            onClick={onUpdate}
            className="rounded-xl bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all duration-150 press-effect"
          >
            Update Now
          </button>
        </div>
      </div>
    </div>
  );
}
