// Adding a co-owner to a shared project (soot docs/collab-shared-key.md §1-2):
// declare them with an `owner` tag on the project AND on every track the
// project key signed, then send them the key. Gating is per event, so on a
// private project an owner missing from a track's tags couldn't read it.

import type { MusicAlbum, MusicMember, MusicTrack } from "@/types/music";
import { signAndPublish } from "@/lib/nostr/publish";
import { buildAlbumEvent, buildTrackEvent } from "../musicEventBuilder";
import { signerForRelease } from "./ownership";
import { NO_PROJECT_KEY_MESSAGE, albumParamsFrom, trackParamsFrom } from "./releaseEdit";
import { shareHeldProjectKey } from "./projectKeySender";

function withOwner(members: readonly MusicMember[] | undefined, owner: string): MusicMember[] {
  const list = [...(members ?? [])];
  if (!list.some((m) => m.pubkey === owner && m.role === "owner")) list.push({ pubkey: owner, role: "owner" });
  return list;
}

export async function addProjectOwner(
  album: MusicAlbum,
  tracks: Readonly<Record<string, MusicTrack>>,
  owner: string,
): Promise<void> {
  const author = await signerForRelease(album.pubkey);
  if (!author?.signer) throw new Error(NO_PROJECT_KEY_MESSAGE);
  const auth = { signer: author.signer };

  if (!(album.owners ?? []).includes(owner)) {
    await signAndPublish(
      buildAlbumEvent(album.pubkey, { ...albumParamsFrom(album), members: withOwner(album.members, owner) }),
      undefined,
      auth,
    );
  }

  // Keyless contributors' tracks keep their own authors and tags.
  for (const ref of album.trackRefs) {
    const track = tracks[ref];
    if (!track || track.pubkey !== album.pubkey || (track.owners ?? []).includes(owner)) continue;
    const params = trackParamsFrom(track);
    if (!params) continue;
    await signAndPublish(
      buildTrackEvent(track.pubkey, { ...params, members: withOwner(track.members, owner) }),
      undefined,
      auth,
    );
  }

  await shareHeldProjectKey(album.pubkey, owner);
}
