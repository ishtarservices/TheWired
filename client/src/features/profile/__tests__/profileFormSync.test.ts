import { describe, it, expect } from "vitest";
import { profileToForm, syncProfileForm, PROFILE_FORM_FIELDS, type ProfileFormField } from "../profileFormSync";
import { buildProfileEvent } from "../../../lib/nostr/eventBuilder";

const PK = "f".repeat(64);
const none = new Set<ProfileFormField>();

describe("profileToForm", () => {
  it("returns all form fields as empty strings for a null profile", () => {
    const form = profileToForm(null);
    for (const f of PROFILE_FORM_FIELDS) expect(form[f]).toBe("");
  });

  it("maps present fields and blanks missing ones", () => {
    const form = profileToForm({ name: "Luna", lud16: "luna@x.com" });
    expect(form.name).toBe("Luna");
    expect(form.lud16).toBe("luna@x.com");
    expect(form.about).toBe("");
  });
});

describe("syncProfileForm", () => {
  it("fills every field from incoming when nothing is touched (cold-login race)", () => {
    const prev = profileToForm(null); // mounted empty before relay arrived
    const incoming = { name: "Luna", about: "bio", nip05: "luna@x", lud16: "luna@x.com" };
    const next = syncProfileForm(prev, incoming, none);
    expect(next.name).toBe("Luna");
    expect(next.about).toBe("bio");
    expect(next.nip05).toBe("luna@x");
    expect(next.lud16).toBe("luna@x.com");
  });

  it("keeps a touched field but fills the untouched ones (no all-or-nothing)", () => {
    // User typed `name` before the profile arrived; everything else untouched.
    const prev = { ...profileToForm(null), name: "MyNewName" };
    const incoming = { name: "OldName", about: "real bio", lud16: "me@wallet.com" };
    const next = syncProfileForm(prev, incoming, new Set<ProfileFormField>(["name"]));
    expect(next.name).toBe("MyNewName"); // user's edit preserved
    expect(next.about).toBe("real bio"); // untouched → filled from relay
    expect(next.lud16).toBe("me@wallet.com");
  });

  it("never reads fields outside the known form set", () => {
    const next = syncProfileForm(profileToForm(null), { name: "Luna" }, none);
    expect(Object.keys(next).sort()).toEqual([...PROFILE_FORM_FIELDS].sort());
  });
});

describe("form-sync + buildProfileEvent (end-to-end no-wipe)", () => {
  it("typing only name then saving keeps relay's about/lud16 and preserves lud06", () => {
    // Profile that arrived from relay (incl. an unmodeled lud06).
    const relayProfile = {
      name: "OldName",
      about: "real bio",
      lud16: "me@wallet.com",
      lud06: "lnurl1keepme",
      created_at: 1700000000,
    };
    // 1) form mounts empty, user types a name
    const typed = { ...profileToForm(null), name: "MyNewName" };
    // 2) relay event lands → per-field sync
    const synced = syncProfileForm(typed, relayProfile, new Set<ProfileFormField>(["name"]));
    // 3) save merges the form over the full profile
    const ev = buildProfileEvent(PK, synced, relayProfile);
    const parsed = JSON.parse(ev.content);

    expect(parsed.name).toBe("MyNewName"); // user's edit
    expect(parsed.about).toBe("real bio"); // NOT wiped
    expect(parsed.lud16).toBe("me@wallet.com"); // NOT wiped
    expect(parsed.lud06).toBe("lnurl1keepme"); // unmodeled field preserved
    expect(parsed).not.toHaveProperty("created_at");
  });

  it("clearing a field publishes its removal (intentional)", () => {
    const relayProfile = { name: "Luna", website: "https://old.example" };
    const cleared = syncProfileForm(profileToForm(relayProfile), relayProfile, none);
    cleared.website = ""; // user clears it
    const ev = buildProfileEvent(PK, cleared, relayProfile);
    const parsed = JSON.parse(ev.content);
    expect(parsed.name).toBe("Luna");
    expect(parsed).not.toHaveProperty("website");
  });
});
