const MIME_EXT_MAP: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/webm": ".webm",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/octet-stream": "",
};

/** Map a MIME type to a file extension (with leading dot). Returns "" for unknown types. */
export function mimeToExt(mime: string | null | undefined): string {
  if (!mime) return "";
  return MIME_EXT_MAP[mime] ?? "";
}

/** Map a file extension to a MIME type. */
export function extToMime(ext: string): string {
  for (const [mime, e] of Object.entries(MIME_EXT_MAP)) {
    if (e === ext) return mime;
  }
  return "application/octet-stream";
}
