import type { Kind0Profile } from "../../types/profile";

/** What a recipient's profile resolves to for zapping. */
export interface ZapTargetEndpoint {
  /** Lightning address (`name@domain`), preferred when present. */
  lud16?: string;
  /** LNURL fallback (the profile's lud06) — only set when lud16 is absent, so
   *  resolveZapEndpoint prefers lud16 and we never pass both. */
  lnurl?: string;
  /** Whether the recipient can receive a zap at all. */
  canZap: boolean;
  /** Human label for the address line (the raw lud06 bech32 is not shown). */
  display?: string;
}

/**
 * Resolve how to zap a recipient from their kind:0 profile. Prefers lud16; falls
 * back to lud06 (an LNURL) so users whose other client only published lud06 are
 * still zappable. Empty strings count as "not set".
 */
export function resolveZapTarget(
  profile: Kind0Profile | null | undefined,
): ZapTargetEndpoint {
  const lud16 = profile?.lud16 || undefined;
  const lud06 = profile?.lud06 || undefined;
  return {
    lud16,
    lnurl: lud16 ? undefined : lud06,
    canZap: !!(lud16 || lud06),
    display: lud16 || (lud06 ? "Lightning (LNURL)" : undefined),
  };
}
