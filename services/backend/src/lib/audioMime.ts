/**
 * Audio upload content types. Clients report the same container under several
 * names — iOS's document picker says `audio/x-m4a` for an .m4a (which IS
 * `audio/mp4`), browsers send `audio/x-flac`, `audio/wave`, parameters such as
 * `; codecs=…` — so the upload route canonicalizes before checking the allowlist
 * and stores the canonical name (it becomes the blob's served Content-Type and
 * the transcode job's input type).
 */

/** Canonical types the music upload accepts. */
export const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/webm",
  "audio/aiff",
  "audio/x-aiff",
]);

/** Platform spellings → the canonical allowlisted type. */
const AUDIO_TYPE_ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-mp4": "audio/mp4",
  "audio/mp4a-latm": "audio/mp4",
  "audio/x-flac": "audio/flac",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-aac": "audio/aac",
  "audio/aacp": "audio/aac",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/mpeg3": "audio/mpeg",
  "audio/x-mpeg-3": "audio/mpeg",
  "audio/x-ogg": "audio/ogg",
  "application/ogg": "audio/ogg",
};

/**
 * Canonical audio type for an upload's declared mime, or null when it isn't an
 * audio type the pipeline takes. Case-insensitive; `;`-parameters are ignored.
 */
export function canonicalAudioType(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const bare = mime.split(";")[0].trim().toLowerCase();
  const canonical = AUDIO_TYPE_ALIASES[bare] ?? bare;
  return ALLOWED_AUDIO_TYPES.has(canonical) ? canonical : null;
}
