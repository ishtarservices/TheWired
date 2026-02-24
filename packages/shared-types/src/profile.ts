/** Parsed kind:0 profile content */
export interface Kind0Profile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

/** Profile with metadata */
export interface UserProfile {
  pubkey: string;
  profile: Kind0Profile;
  relayHint?: string;
  fetchedAt: number;
}
