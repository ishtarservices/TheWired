import { isUnsafeHost } from "@/lib/security/ssrfGuard";
import type { MusicTrack } from "@/types/music";

/**
 * Can anyone but its uploader play this track? A release whose every audio
 * variant sits on a loopback / private / LAN host (a dev machine's
 * `http://localhost:9080/<sha>`) is dead weight on a discovery rail: public
 * relays carry such QA uploads, and the relay fallback would show them.
 *
 * `ownApiOrigin` is exempt so a dev build pointed at a local stack still lists
 * its own local uploads. A track with no variants at all is kept: that isn't a
 * reachability question, and other checks decide it.
 */
export function hasReachableAudio(track: Pick<MusicTrack, "variants">, ownApiOrigin: string): boolean {
  if (track.variants.length === 0) return true;
  return track.variants.some((v) => {
    try {
      const url = new URL(v.url);
      return url.origin === ownApiOrigin || !isUnsafeHost(url.hostname);
    } catch {
      return false;
    }
  });
}
