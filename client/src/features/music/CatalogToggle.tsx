import { ListMusic } from "lucide-react";

interface CatalogToggleProps {
  /** Whether the track is listed on the author's catalog (checked = listed). */
  value: boolean;
  onChange: (inCatalog: boolean) => void;
}

/**
 * Lets the owner keep a public track off their catalog. The stored flag is
 * `["catalog","none"]` when unchecked (`inCatalog = false`). Mobile writes it
 * for audio attached to a plain note; the clip stays public and playable from
 * that note, but is hidden from the artist's profile/library and from browse,
 * trending and search. This is not a privacy control — use Visibility for that.
 */
export function CatalogToggle({ value, onChange }: CatalogToggleProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-xs text-soft">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-2 border-border bg-field checked:bg-primary checked:border-primary accent-purple-400"
        />
        <ListMusic size={13} className="text-muted" />
        In my catalog
      </label>
      <p className="mt-1 pl-6 text-[10px] leading-snug text-muted">
        When off, the track stays public and playable wherever it is embedded, but is
        hidden from your profile, your library and from browse, trending and search.
      </p>
    </div>
  );
}
