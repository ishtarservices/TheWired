import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { setActiveDetailId, setMusicView } from "@/store/slices/musicSlice";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { resolveMusic } from "@/lib/api/music";
import { Spinner } from "@/components/ui/Spinner";

interface MusicLinkResolverProps {
  type: "album" | "track";
}

export function MusicLinkResolver({ type }: MusicLinkResolverProps) {
  const { pubkey, slug } = useParams<{ pubkey: string; slug: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [error, setError] = useState<string | null>(null);

  const kind = type === "album" ? 33123 : 31683;
  const addressableId = pubkey && slug ? `${kind}:${pubkey}:${slug}` : null;

  const existingAlbum = useAppSelector((s) =>
    addressableId && type === "album" ? s.music.albums[addressableId] : undefined,
  );
  const existingTrack = useAppSelector((s) =>
    addressableId && type === "track" ? s.music.tracks[addressableId] : undefined,
  );

  useEffect(() => {
    if (!pubkey || !slug || !addressableId) {
      setError("Invalid link");
      return;
    }

    // If already in store, navigate immediately
    if (type === "album" && existingAlbum) {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
      navigate("/", { replace: true });
      return;
    }
    if (type === "track" && existingTrack) {
      navigateForTrack(existingTrack.albumRef);
      return;
    }

    // Fetch from backend
    let cancelled = false;

    async function resolve() {
      try {
        const result = await resolveMusic(type, pubkey!, slug!);
        if (cancelled) return;

        const data = result.data;
        // Process the main event through the pipeline
        await processIncomingEvent((data as { event: unknown }).event, "resolve");

        // Process associated track events for albums
        if ("tracks" in data && Array.isArray(data.tracks)) {
          for (const trackEvent of data.tracks) {
            await processIncomingEvent(trackEvent, "resolve");
          }
        }

        // Navigate to the appropriate view
        if (type === "album") {
          dispatch(setSidebarMode("music"));
          dispatch(setActiveDetailId({ view: "album-detail", id: addressableId! }));
          navigate("/", { replace: true });
        } else {
          // For tracks: check if it has an albumRef from the event tags
          const event = (data as { event: { tags: string[][] } }).event;
          const aTag = event.tags?.find(
            (t: string[]) => t[0] === "a" && t[1]?.startsWith("33123:"),
          );
          if (aTag?.[1]) {
            // Resolve and navigate to the parent album
            const [, albumPubkey, ...albumSlugParts] = aTag[1].split(":");
            const albumSlug = albumSlugParts.join(":");
            try {
              const albumResult = await resolveMusic("album", albumPubkey, albumSlug);
              if (!cancelled) {
                await processIncomingEvent(
                  (albumResult.data as { event: unknown }).event,
                  "resolve",
                );
                if ("tracks" in albumResult.data && Array.isArray(albumResult.data.tracks)) {
                  for (const te of albumResult.data.tracks) {
                    await processIncomingEvent(te, "resolve");
                  }
                }
                dispatch(setSidebarMode("music"));
                dispatch(setActiveDetailId({ view: "album-detail", id: aTag[1] }));
                navigate("/", { replace: true });
              }
            } catch {
              // Album resolve failed, fall back to music home
              if (!cancelled) {
                dispatch(setSidebarMode("music"));
                dispatch(setMusicView("home"));
                navigate("/", { replace: true });
              }
            }
          } else {
            // No album ref, go to music home
            dispatch(setSidebarMode("music"));
            dispatch(setMusicView("home"));
            navigate("/", { replace: true });
          }
        }
      } catch {
        if (!cancelled) setError("Content not found");
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [pubkey, slug, addressableId, type]);

  function navigateForTrack(albumRef?: string) {
    if (albumRef) {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view: "album-detail", id: albumRef }));
    } else {
      dispatch(setSidebarMode("music"));
      dispatch(setMusicView("home"));
    }
    navigate("/", { replace: true });
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-heading">Not Found</p>
          <p className="mt-1 text-sm text-soft">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="mt-4 rounded-full border border-white/[0.04] px-4 py-1.5 text-sm text-soft hover:border-white/[0.08] hover:text-heading"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}
