import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { useAppSelector } from "../../store/hooks";
import { buildProfileEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import type { Kind0Profile } from "../../types/profile";

interface ProfileEditModalProps {
  onClose: () => void;
}

export function ProfileEditModal({ onClose }: ProfileEditModalProps) {
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

  const handleSave = async () => {
    if (!pubkey) return;
    setSaving(true);
    setError(null);

    try {
      const unsigned = buildProfileEvent(pubkey, form);
      await signAndPublish(unsigned);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof Kind0Profile, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Modal open onClose={onClose}>
      <div className="w-full max-w-md rounded-xl glass-panel p-6 glow-neon">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Edit Profile</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        <div className="space-y-3">
          {(
            [
              ["name", "Username"],
              ["display_name", "Display Name"],
              ["about", "About"],
              ["picture", "Avatar URL"],
              ["banner", "Banner URL"],
              ["nip05", "NIP-05 Identifier"],
              ["lud16", "Lightning Address"],
              ["website", "Website"],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label className="mb-1 block text-xs text-soft">
                {label}
              </label>
              {field === "about" ? (
                <textarea
                  value={form[field] ?? ""}
                  onChange={(e) => updateField(field, e.target.value)}
                  className="w-full rounded-md border border-edge-light bg-field px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
                  rows={3}
                />
              ) : (
                <input
                  type="text"
                  value={form[field] ?? ""}
                  onChange={(e) => updateField(field, e.target.value)}
                  className="w-full rounded-md border border-edge-light bg-field px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
                />
              )}
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" /> : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
