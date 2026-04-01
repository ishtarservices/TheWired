import { useState, useEffect, useRef } from "react";
import { Compass, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ImageUpload } from "../../../components/ui/ImageUpload";
import { useAppSelector, useAppDispatch } from "../../../store/hooks";
import { updateSpace } from "../../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../../lib/db/spaceStore";
import { useAutoResize } from "../../../hooks/useAutoResize";
import { getSpace } from "../../../lib/api/spaces";
import {
  getDiscoverCategories,
  submitListingRequest,
  getListingRequests,
  type SpaceCategory,
  type ListingRequest,
} from "../../../lib/api/discover";

interface GeneralTabProps {
  spaceId: string;
}

export function GeneralTab({ spaceId }: GeneralTabProps) {
  const dispatch = useAppDispatch();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));

  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [saved, setSaved] = useState(false);
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(aboutRef, about, 200);

  useEffect(() => {
    if (!space) return;
    setName(space.name);
    setAbout(space.about ?? "");
    setPicture(space.picture ?? "");
  }, [space]);

  if (!space) return null;

  function handleSave() {
    const updated = {
      ...space!,
      name: name.trim() || space!.name,
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
    };
    dispatch(updateSpace(updated));
    updateSpaceInStore(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-heading">General Settings</h3>

        <div>
          <label className="mb-1 block text-xs font-medium text-soft">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-soft">Description</label>
          <textarea
            ref={aboutRef}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={2}
            className="w-full resize-none overflow-hidden rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
          />
        </div>

        <ImageUpload
          value={picture}
          onChange={setPicture}
          label="Picture"
          placeholder="Drop space image or click to upload"
          shape="square"
        />

        <div className="flex items-center gap-3">
          <Button variant="primary" size="md" onClick={handleSave}>
            Save Changes
          </Button>
          {saved && <span className="text-xs text-green-400">Saved!</span>}
        </div>
      </div>

      {/* Discovery Listing */}
      <div className="border-t border-border pt-6">
        <DiscoverySection spaceId={spaceId} />
      </div>
    </div>
  );
}

// ── Discovery Listing Section ───────────────────────────────────

function DiscoverySection({ spaceId }: { spaceId: string }) {
  const [listed, setListed] = useState<boolean | null>(null);
  const [currentCategory, setCurrentCategory] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<ListingRequest | null>(null);
  const [categories, setCategories] = useState<SpaceCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch listing status + categories on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [spaceRes, catsRes, requestsRes] = await Promise.all([
          getSpace(spaceId).catch(() => null),
          getDiscoverCategories().catch(() => ({ data: [] })),
          getListingRequests().catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;

        // Backend returns full space including listed/category
        const spaceData = spaceRes?.data as any;
        setListed(spaceData?.listed ?? false);
        setCurrentCategory(spaceData?.category ?? null);
        setCategories(catsRes.data);

        // Check for pending request for this space
        const pending = requestsRes.data.find(
          (r: ListingRequest) => r.spaceId === spaceId && r.status === "pending",
        );
        setPendingRequest(pending ?? null);
      } catch {
        // Couldn't fetch — show submit form anyway
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [spaceId]);

  const handleSubmit = async () => {
    if (!selectedCategory) return;

    setSubmitting(true);
    setResult(null);

    try {
      const res = await submitListingRequest({
        spaceId,
        category: selectedCategory,
        reason: reason.trim() || undefined,
      });

      const status = res.data.status;
      if (status === "approved") {
        setListed(true);
        setCurrentCategory(selectedCategory);
        setResult({ status: "approved", message: "Your space is now listed on Discover!" });
      } else {
        setPendingRequest({ id: res.data.id, spaceId, status: "pending" } as ListingRequest);
        setResult({ status: "pending", message: "Listing request submitted and is pending review." });
      }
    } catch (err: any) {
      setResult({ status: "error", message: err?.message ?? "Failed to submit listing request." });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-heading flex items-center gap-2">
          <Compass size={14} /> Discovery
        </h3>
        <div className="h-16 rounded-xl bg-card-hover/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-heading flex items-center gap-2">
        <Compass size={14} /> Discovery
      </h3>
      <p className="text-xs text-muted">
        List your space on the Discover page so others can find and join it.
      </p>

      {/* Already listed */}
      {listed && (
        <div className="flex items-center gap-2 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2.5">
          <CheckCircle size={14} className="text-green-400 shrink-0" />
          <div>
            <p className="text-xs font-medium text-green-300">Listed on Discover</p>
            {currentCategory && (
              <p className="text-[11px] text-green-400/70 mt-0.5">
                Category: {categories.find((c) => c.slug === currentCategory)?.name ?? currentCategory}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Pending request */}
      {!listed && pendingRequest && (
        <div className="flex items-center gap-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-3 py-2.5">
          <Clock size={14} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-xs font-medium text-yellow-300">Listing request pending</p>
            <p className="text-[11px] text-yellow-400/70 mt-0.5">
              Your request is being reviewed. Spaces with 20+ members are auto-approved.
            </p>
          </div>
        </div>
      )}

      {/* Submit form */}
      {!listed && !pendingRequest && (
        <div className="space-y-3 rounded-xl bg-surface border border-border p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
            >
              <option value="">Select a category...</option>
              {categories.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Why should this space be listed? <span className="text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Brief description..."
              className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
            />
          </div>

          <Button
            variant="accent"
            size="md"
            onClick={handleSubmit}
            disabled={!selectedCategory || submitting}
          >
            {submitting ? "Submitting..." : "Submit for Listing"}
          </Button>
        </div>
      )}

      {/* Result feedback */}
      {result && (
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2 ${
          result.status === "error"
            ? "bg-red-500/10 border border-red-500/20"
            : result.status === "approved"
              ? "bg-green-500/10 border border-green-500/20"
              : "bg-yellow-500/10 border border-yellow-500/20"
        }`}>
          {result.status === "error" ? (
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
          ) : result.status === "approved" ? (
            <CheckCircle size={14} className="mt-0.5 shrink-0 text-green-400" />
          ) : (
            <Clock size={14} className="mt-0.5 shrink-0 text-yellow-400" />
          )}
          <p className={`text-xs ${
            result.status === "error" ? "text-red-300" : result.status === "approved" ? "text-green-300" : "text-yellow-300"
          }`}>
            {result.message}
          </p>
        </div>
      )}
    </div>
  );
}
