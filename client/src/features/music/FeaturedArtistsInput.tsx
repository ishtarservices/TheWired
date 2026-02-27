import { useState } from "react";
import { X } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useProfile } from "@/features/profile/useProfile";

/** Inline display of a featured artist pubkey (resolves name via profile) */
function ArtistChip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const { profile } = useProfile(pubkey);
  const label = profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-heading">
      <span className="max-w-[120px] truncate">{label}</span>
      <button onClick={onRemove} className="text-muted hover:text-heading">
        <X size={12} />
      </button>
    </span>
  );
}

function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return null;
    }
  }
  return null;
}

interface FeaturedArtistsInputProps {
  value: string[];
  onChange: (pubkeys: string[]) => void;
  label?: string;
  placeholder?: string;
}

export function FeaturedArtistsInput({
  value,
  onChange,
  label = "Featured Artists",
  placeholder = "Paste npub or hex pubkey and press Enter",
}: FeaturedArtistsInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addArtist = () => {
    const pubkey = parsePubkeyInput(input);
    if (!pubkey) {
      setError("Invalid npub or hex pubkey");
      return;
    }
    if (value.includes(pubkey)) {
      setError("Already added");
      return;
    }
    onChange([...value, pubkey]);
    setInput("");
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addArtist();
    }
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-soft">
        {label}
      </label>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((pk) => (
            <ArtistChip
              key={pk}
              pubkey={pk}
              onRemove={() => onChange(value.filter((p) => p !== pk))}
            />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={addArtist}
          disabled={!input.trim()}
          className="rounded-xl border border-white/[0.04] px-3 py-1.5 text-xs text-soft transition-colors hover:border-white/[0.08] hover:text-heading disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
