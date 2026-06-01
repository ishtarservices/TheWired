import { useMemo, useState } from "react";
import { Server, Plus, X, Loader2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { updateSpace } from "../../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../../lib/db/spaceStore";
import { signAndPublish } from "../../../lib/nostr/publish";
import {
  buildRelaySetEvent,
  resolveRelaySet,
  sanitizeRelayUrl,
} from "../relaySet";
import { hostToRelayUrl } from "../spaceType";

/**
 * Mirror-relay management (Decentralized Spaces M9). An admin declares the
 * space's relay set — the host (authority) plus mirror relays that hold a
 * replica — and publishes it as a `wired:relays:<id>` kind:30078 overlay. Other
 * members learn it and then read-from-any / publish-to-all.
 */
export function RelaysTab({ spaceId }: { spaceId: string }) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));

  // Current mirrors = the relay set minus the authority (hostRelay).
  const initialMirrors = useMemo(
    () => (space ? resolveRelaySet(space).filter((u) => u !== space.hostRelay) : []),
    [space],
  );
  const [mirrors, setMirrors] = useState<string[]>(initialMirrors);
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!space || !pubkey) return null;

  const addMirror = () => {
    const url = sanitizeRelayUrl(hostToRelayUrl(draft.trim()));
    if (!url) {
      setError("Enter a valid ws:// or wss:// relay URL");
      return;
    }
    if (url === space.hostRelay || mirrors.includes(url)) {
      setError("That relay is already in the set");
      return;
    }
    setMirrors((m) => [...m, url]);
    setDraft("");
    setError(null);
    setSaved(false);
  };

  const removeMirror = (url: string) => {
    setMirrors((m) => m.filter((u) => u !== url));
    setSaved(false);
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const event = buildRelaySetEvent(pubkey, space.id, space.hostRelay, mirrors);
      // Publish the overlay to the whole set so every relay carries it.
      await signAndPublish(event, resolveRelaySet({ ...space, relayUrls: mirrors }));
      // Apply locally (the read path stores authority + mirrors).
      const relayUrls = Array.from(new Set([space.hostRelay, ...mirrors]));
      const updated = { ...space, relayUrls };
      dispatch(updateSpace(updated));
      void updateSpaceInStore(updated).catch(() => {});
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  };

  const dirty =
    mirrors.length !== initialMirrors.length ||
    mirrors.some((u) => !initialMirrors.includes(u));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-heading">Relays</h3>
        <p className="mt-1 text-xs text-muted">
          This space lives on its host relay (the signing authority). Add mirror
          relays that hold a copy so the space stays reachable when the host is
          offline — members read from whichever answers and post to all.
        </p>
      </div>

      {/* Authority (read-only) */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-soft">Host (authority)</label>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <Server size={13} className="shrink-0 text-primary" />
          <code className="truncate text-xs text-heading">{space.hostRelay}</code>
        </div>
      </div>

      {/* Mirrors */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-soft">Mirrors</label>
        {mirrors.length === 0 ? (
          <p className="text-[11px] text-muted/70 italic">No mirror relays yet.</p>
        ) : (
          <div className="space-y-1">
            {mirrors.map((url) => (
              <div
                key={url}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5"
              >
                <Server size={13} className="shrink-0 text-muted" />
                <code className="min-w-0 flex-1 truncate text-xs text-heading">{url}</code>
                <button
                  onClick={() => removeMirror(url)}
                  className="shrink-0 rounded-full p-0.5 text-muted hover:bg-surface-hover hover:text-heading"
                  aria-label="Remove mirror"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add mirror */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && addMirror()}
          placeholder="relay.example.com or wss://relay.example.com"
          className="flex-1 rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none"
        />
        <button
          onClick={addMirror}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-faint"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={publish}
          disabled={publishing || !dirty}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {publishing && <Loader2 size={13} className="animate-spin" />}
          Publish relay set
        </button>
        {saved && !dirty && <span className="text-[11px] text-primary">Saved.</span>}
      </div>
    </div>
  );
}
