/** Parsed kind:0 profile content */
export interface Kind0Profile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  /** Lightning address, `name@domain` form (NIP-57). Preferred over lud06. */
  lud16?: string;
  /** bech32-encoded LNURL-pay (`lnurl1…`), the older NIP-57 form. Some clients
   *  set this instead of lud16; we preserve and zap-resolve it. */
  lud06?: string;
  website?: string;
  created_at?: number;
}

/** Profile with metadata */
export interface UserProfile {
  pubkey: string;
  profile: Kind0Profile;
  relayHint?: string;
  fetchedAt: number;
}
