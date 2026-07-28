import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setLibraryTrackSort, setLibraryAlbumSort } from "@/store/slices/musicSlice";
import type { TrackSortKey, AlbumSortKey, SortDir } from "@/types/music";
import { defaultDir, flipDir } from "./sortMusic";

interface TrackSortControls {
  key: TrackSortKey;
  dir: SortDir;
  /** Pick a new key from the dropdown (direction resets to the key's sensible default). */
  setKey: (key: TrackSortKey) => void;
  /** Flip ascending/descending, keeping the current key. */
  toggleDir: () => void;
  /** Column-header click: flip direction if already active, else switch to the key's default. */
  sortByHeader: (key: TrackSortKey) => void;
}

/** Persisted, app-wide track sort preference (Songs / Recently Added / Favorites / My Uploads). */
export function useTrackSort(): TrackSortControls {
  const dispatch = useAppDispatch();
  const key = useAppSelector((s) => s.music.librarySort.trackKey);
  const dir = useAppSelector((s) => s.music.librarySort.trackDir);

  const setKey = useCallback(
    (k: TrackSortKey) => dispatch(setLibraryTrackSort({ key: k, dir: defaultDir(k) })),
    [dispatch],
  );
  const toggleDir = useCallback(
    () => dispatch(setLibraryTrackSort({ key, dir: flipDir(dir) })),
    [dispatch, key, dir],
  );
  const sortByHeader = useCallback(
    (k: TrackSortKey) =>
      dispatch(setLibraryTrackSort({ key: k, dir: k === key ? flipDir(dir) : defaultDir(k) })),
    [dispatch, key, dir],
  );

  return { key, dir, setKey, toggleDir, sortByHeader };
}

interface AlbumSortControls {
  key: AlbumSortKey;
  dir: SortDir;
  setKey: (key: AlbumSortKey) => void;
  toggleDir: () => void;
}

/** Persisted, app-wide album/project sort preference. */
export function useAlbumSort(): AlbumSortControls {
  const dispatch = useAppDispatch();
  const key = useAppSelector((s) => s.music.librarySort.albumKey);
  const dir = useAppSelector((s) => s.music.librarySort.albumDir);

  const setKey = useCallback(
    (k: AlbumSortKey) => dispatch(setLibraryAlbumSort({ key: k, dir: defaultDir(k) })),
    [dispatch],
  );
  const toggleDir = useCallback(
    () => dispatch(setLibraryAlbumSort({ key, dir: flipDir(dir) })),
    [dispatch, key, dir],
  );

  return { key, dir, setKey, toggleDir };
}
