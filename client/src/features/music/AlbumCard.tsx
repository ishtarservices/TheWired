import { memo, useRef, useState } from "react";
import { Disc3, MoreHorizontal, Pencil, Link2, Heart } from "lucide-react";
import type { MusicAlbum } from "@/types/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { CreateAlbumModal } from "./CreateAlbumModal";
import { useLibrary } from "./useLibrary";
import { buildMusicLink } from "./musicLinks";
import { copyToClipboard } from "@/lib/clipboard";

interface AlbumCardProps {
  album: MusicAlbum;
}

export const AlbumCard = memo(function AlbumCard({ album }: AlbumCardProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwner = pubkey === album.pubkey;
  const isLocal = album.visibility === "local";
  const { saveAlbum, unsaveAlbum, isAlbumSaved } = useLibrary();
  const saved = isAlbumSaved(album.addressableId);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <button
        onClick={() =>
          dispatch(
            setActiveDetailId({ view: "album-detail", id: album.addressableId }),
          )
        }
        className="group relative flex w-full flex-col rounded-xl border border-white/[0.04] card-glass transition-all hover:border-white/[0.08] hover-lift"
      >
        <div className="aspect-square w-full overflow-hidden rounded-t-xl">
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-card">
              <Disc3 size={32} className="text-muted" />
            </div>
          )}
        </div>
        {(isOwner || !isLocal) && (
          <div className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="relative">
              <button
                ref={menuBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="rounded-full bg-backdrop/70 p-1 text-soft hover:text-heading"
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <PopoverMenu open={menuOpen} onClose={() => setMenuOpen(false)} position="below" anchorRef={menuBtnRef}>
                  {!isOwner && !isLocal && (
                    <PopoverMenuItem
                      icon={<Heart size={14} className={saved ? "fill-red-500 text-red-500" : ""} />}
                      label={saved ? "Remove from Library" : "Add to Library"}
                      onClick={() => {
                        setMenuOpen(false);
                        if (saved) unsaveAlbum(album.addressableId);
                        else saveAlbum(album.addressableId);
                      }}
                    />
                  )}
                  {!isLocal && (
                    <PopoverMenuItem
                      icon={<Link2 size={14} />}
                      label="Copy Link"
                      onClick={() => {
                        setMenuOpen(false);
                        copyToClipboard(buildMusicLink(album.addressableId));
                      }}
                    />
                  )}
                  {isOwner && (
                    <>
                      {!isLocal && <PopoverMenuSeparator />}
                      <PopoverMenuItem
                        icon={<Pencil size={14} />}
                        label="Edit Project"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditOpen(true);
                        }}
                      />
                    </>
                  )}
                </PopoverMenu>
              )}
            </div>
          </div>
        )}
        <div className="p-2">
          <p className="truncate text-sm font-medium text-heading">{album.title}</p>
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs text-soft">{album.artist}</p>
            {album.projectType !== "album" && (
              <span className="shrink-0 rounded bg-card-hover/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                {album.projectType}
              </span>
            )}
          </div>
        </div>
      </button>
      {editOpen && (
        <CreateAlbumModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          album={album}
        />
      )}
    </>
  );
});
