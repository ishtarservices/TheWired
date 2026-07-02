import { Download } from "lucide-react";

interface ExportToggleProps {
  /** Whether listeners are allowed to export the audio file (checked = allowed). */
  value: boolean;
  onChange: (allowExport: boolean) => void;
  /** Override the label (e.g. "this project" for albums). */
  label?: string;
}

/**
 * Lets the artist/uploader decide whether others can export (save to disk) the
 * audio file. The stored flag is the inverse: `sharingDisabled = !value`.
 *
 * Streaming and in-app offline download are unaffected — only the "Export File"
 * button is hidden for non-owners. The audio URL itself is public, so this is a
 * request to listeners, not hard protection.
 */
export function ExportToggle({ value, onChange, label }: ExportToggleProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-xs text-soft">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-2 border-border bg-field checked:bg-primary checked:border-primary accent-purple-400"
        />
        <Download size={13} className="text-muted" />
        {label ?? "Allow file export"}
      </label>
      <p className="mt-1 pl-6 text-[10px] leading-snug text-muted">
        When off, listeners can still stream but the “Export File” button is hidden.
        The audio link is public, so this is a request, not hard protection.
      </p>
    </div>
  );
}
