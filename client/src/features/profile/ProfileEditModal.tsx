import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { useAppSelector } from "../../store/hooks";
import { buildProfileEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { useAutoResize } from "../../hooks/useAutoResize";
import type { Kind0Profile } from "../../types/profile";
import { sanitizeNip05Input } from "../../lib/nip05Utils";
import {
  profileToForm,
  syncProfileForm,
  type ProfileFormField,
} from "./profileFormSync";

interface ProfileEditModalProps {
  onClose: () => void;
}

export function ProfileEditModal({ onClose }: ProfileEditModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const existingProfile = useAppSelector((s) => s.identity.profile);
  const profileCreatedAt = useAppSelector((s) => s.identity.profileCreatedAt);
  const profileChecked = useAppSelector((s) => s.identity.profileChecked);

  const [form, setForm] = useState<Kind0Profile>(() => profileToForm(existingProfile));

  // Re-sync if the profile arrives/updates after mount (cold-login race). Only
  // fields the user hasn't edited are filled, so a half-edited form still picks
  // up the rest of the real profile rather than publishing those fields as empty
  // on save. See profileFormSync + ProfileSettingsTab for the full rationale.
  const touched = useRef<Set<ProfileFormField>>(new Set());
  const [syncedAt, setSyncedAt] = useState(0);
  useEffect(() => {
    if (!existingProfile || profileCreatedAt <= syncedAt) return;
    setForm((prev) => syncProfileForm(prev, existingProfile, touched.current));
    setSyncedAt(profileCreatedAt);
  }, [existingProfile, profileCreatedAt, syncedAt]);

  const aboutRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(aboutRef, form.about ?? "", 200);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!pubkey) return;
    setSaving(true);
    setError(null);

    try {
      // Merge over the last-known profile so unmodeled fields (lud06, custom
      // keys) survive the republish instead of being wiped.
      const unsigned = buildProfileEvent(pubkey, form, existingProfile ?? undefined);
      await signAndPublish(unsigned);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: ProfileFormField, value: string) => {
    touched.current.add(field);
    setForm((prev) => ({
      ...prev,
      [field]: field === "nip05" ? sanitizeNip05Input(value) : value,
    }));
  };

  return (
    <Modal open onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Edit Profile</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        <div className="space-y-3">
          <ImageUpload
            value={form.picture ?? ""}
            onChange={(url) => updateField("picture", url)}
            label="Avatar"
            placeholder="Drop avatar image or click to upload"
            shape="circle"
          />

          <ImageUpload
            value={form.banner ?? ""}
            onChange={(url) => updateField("banner", url)}
            label="Banner"
            placeholder="Drop banner image or click to upload"
            shape="banner"
          />

          {(
            [
              ["name", "Username"],
              ["display_name", "Display Name"],
              ["about", "About"],
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
                  ref={aboutRef}
                  value={form[field] ?? ""}
                  onChange={(e) => updateField(field, e.target.value)}
                  className="w-full resize-none overflow-hidden rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading focus:border-primary/30 focus:outline-none transition-colors"
                  rows={2}
                />
              ) : (
                <input
                  type="text"
                  value={form[field] ?? ""}
                  onChange={(e) => updateField(field, e.target.value)}
                  className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading focus:border-primary/30 focus:outline-none transition-colors"
                />
              )}
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {!profileChecked && (
            <span className="mr-auto text-xs text-muted">Loading current profile…</span>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !profileChecked}>
            {saving ? <Spinner size="sm" /> : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
