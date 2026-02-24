import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { useAppSelector } from "../../store/hooks";
import { buildProfileEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import type { Kind0Profile } from "../../types/profile";

const FIELDS: { key: keyof Kind0Profile; label: string }[] = [
  { key: "name", label: "Username" },
  { key: "display_name", label: "Display Name" },
  { key: "about", label: "About" },
  { key: "picture", label: "Avatar URL" },
  { key: "banner", label: "Banner URL" },
  { key: "nip05", label: "NIP-05 Identifier" },
  { key: "lud16", label: "Lightning Address" },
  { key: "website", label: "Website" },
];

export function ProfileSettingsTab() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const existingProfile = useAppSelector((s) => s.identity.profile);

  const [form, setForm] = useState<Kind0Profile>({
    name: existingProfile?.name ?? "",
    display_name: existingProfile?.display_name ?? "",
    about: existingProfile?.about ?? "",
    picture: existingProfile?.picture ?? "",
    banner: existingProfile?.banner ?? "",
    nip05: existingProfile?.nip05 ?? "",
    lud16: existingProfile?.lud16 ?? "",
    website: existingProfile?.website ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateField = (field: keyof Kind0Profile, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess(false);
  };

  const handleSave = async () => {
    if (!pubkey) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const unsigned = buildProfileEvent(pubkey, form);
      await signAndPublish(unsigned);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border border-edge bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-heading">
        Profile Information
      </h3>

      <div className="space-y-3">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="mb-1 block text-xs text-soft">{label}</label>
            {key === "about" ? (
              <textarea
                value={form[key] ?? ""}
                onChange={(e) => updateField(key, e.target.value)}
                className="w-full rounded-md border border-edge-light bg-field px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
                rows={3}
              />
            ) : (
              <input
                type="text"
                value={form[key] ?? ""}
                onChange={(e) => updateField(key, e.target.value)}
                className="w-full rounded-md border border-edge-light bg-field px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {success && (
        <p className="mt-3 text-xs text-green-400">Profile saved!</p>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size="sm" /> : "Save Profile"}
        </Button>
      </div>
    </div>
  );
}
