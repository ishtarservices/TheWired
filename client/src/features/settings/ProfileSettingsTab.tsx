import { useState, useRef, useEffect } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { useAppSelector } from "../../store/hooks";
import { buildProfileEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { useAutoResize } from "../../hooks/useAutoResize";
import { ProfileDisplaySection } from "./ProfileDisplaySection";
import { registerNip05 } from "../../lib/api/nip05";
import type { Kind0Profile } from "../../types/profile";
import { sanitizeNip05Input } from "../../lib/nip05Utils";
import {
  profileToForm,
  syncProfileForm,
  type ProfileFormField,
} from "../profile/profileFormSync";

const FIELDS: { key: ProfileFormField; label: string }[] = [
  { key: "name", label: "Username" },
  { key: "display_name", label: "Display Name" },
  { key: "about", label: "About" },
  { key: "nip05", label: "NIP-05 Identifier" },
  { key: "lud16", label: "Lightning Address" },
  { key: "website", label: "Website" },
];

export function ProfileSettingsTab() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const existingProfile = useAppSelector((s) => s.identity.profile);
  const profileCreatedAt = useAppSelector((s) => s.identity.profileCreatedAt);
  const profileChecked = useAppSelector((s) => s.identity.profileChecked);

  const [form, setForm] = useState<Kind0Profile>(() => profileToForm(existingProfile));

  // Re-sync the form when the profile loads/updates from relays AFTER mount.
  // useState's initializer only runs on first render, so without this the form
  // captures an empty snapshot on a cold login (no IDB cache yet) and the user's
  // real nip05/lud16/etc. never appear. syncProfileForm only fills fields the
  // user hasn't edited (see profileFormSync for the wipe-prevention rationale).
  //
  // NOTE: `syncedAt` is a monotonic high-water mark, which is only safe because
  // AuthGate unmounts this component on logout/account-switch (App.tsx), so it
  // resets per account. If that ever changes (route keep-alive), key this
  // component on `pubkey` so it remounts per account.
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
  const [success, setSuccess] = useState(false);

  const updateField = (field: ProfileFormField, value: string) => {
    touched.current.add(field);
    setForm((prev) => ({
      ...prev,
      [field]: field === "nip05" ? sanitizeNip05Input(value) : value,
    }));
    setSuccess(false);
  };

  const handleSave = async () => {
    if (!pubkey) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Register NIP-05 on backend if it's a @thewired.app identifier
      const nip05Val = form.nip05?.trim() ?? "";
      const nip05Match = nip05Val.match(/^(.+)@thewired\.app$/i);
      if (nip05Match?.[1]) {
        try {
          await registerNip05(nip05Match[1]);
        } catch (e: unknown) {
          const code = (e as { code?: string }).code ?? "";
          if (code !== "ALREADY_REGISTERED") {
            setError(code === "USERNAME_TAKEN"
              ? "That NIP-05 username is already taken."
              : `NIP-05 registration failed: ${e instanceof Error ? e.message : String(e)}`);
            setSaving(false);
            return;
          }
        }
      }

      // Merge over the last-known profile so fields the form doesn't model
      // (lud06, custom keys) are preserved instead of wiped on republish.
      const unsigned = buildProfileEvent(pubkey, form, existingProfile ?? undefined);
      await signAndPublish(unsigned);
      // Reset the edit-tracking baseline so the echoed kind:0 re-syncs cleanly.
      touched.current = new Set();
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
    <div className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-heading">
        Profile Information
      </h3>

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

        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="mb-1 block text-xs text-soft">{label}</label>
            {key === "about" ? (
              <textarea
                ref={aboutRef}
                value={form[key] ?? ""}
                onChange={(e) => updateField(key, e.target.value)}
                className="w-full resize-none overflow-hidden rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
                rows={2}
              />
            ) : (
              <input
                type="text"
                value={form[key] ?? ""}
                onChange={(e) => updateField(key, e.target.value)}
                className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {success && (
        <p className="mt-3 text-xs text-green-400">Profile saved!</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        {!profileChecked && (
          <span className="text-xs text-muted">Loading your current profile…</span>
        )}
        <Button onClick={handleSave} disabled={saving || !profileChecked}>
          {saving ? <Spinner size="sm" /> : "Save Profile"}
        </Button>
      </div>
    </div>

    <ProfileDisplaySection />
    </div>
  );
}
