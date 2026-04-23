import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export interface TranscodeInput {
  /** Absolute path to the source audio file on disk. */
  inputPath: string;
  /** SHA256 of the source file — used as the output directory name. */
  sha256: string;
  /** Absolute blob directory; HLS output lands at `<blobDir>/hls/<sha256>/`. */
  blobDir: string;
}

export interface TranscodeResult {
  /** Relative path from blobDir to the master playlist, e.g. `hls/<sha>/master.m3u8`. */
  hlsRelPath: string;
  /** Integrated loudness in LUFS, if measurement is enabled (currently null; deferred). */
  loudnessI: number | null;
  /** True peak in dBTP, if measurement is enabled (currently null; deferred). */
  loudnessTp: number | null;
}

// Minimal, deterministic audio-only HLS master playlist. Two variants at
// 128 and 256 kbps. Hand-written because ffmpeg's -master_pl_name for
// audio-only streams is historically finicky; this file is 6 lines of text.
const MASTER_PLAYLIST =
  "#EXTM3U\n" +
  "#EXT-X-VERSION:7\n" +
  "#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS=\"mp4a.40.2\"\n" +
  "128k/index.m3u8\n" +
  "#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS=\"mp4a.40.2\"\n" +
  "256k/index.m3u8\n";

/**
 * Produce a two-rendition HLS ladder with −14 LUFS loudness normalization.
 * Single ffmpeg invocation: decode once, normalize once via `loudnorm`,
 * split to two AAC encoders, fMP4 segments at 6s. Safe to retry — failures
 * purge the output directory so a retry starts clean.
 */
export async function transcodeAudio(input: TranscodeInput): Promise<TranscodeResult> {
  const { inputPath, sha256, blobDir } = input;
  const outDir = join(blobDir, "hls", sha256);
  const dir128 = join(outDir, "128k");
  const dir256 = join(outDir, "256k");

  await mkdir(dir128, { recursive: true });
  await mkdir(dir256, { recursive: true });

  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    "-filter_complex",
    "[0:a]loudnorm=I=-14:LRA=11:TP=-1,asplit=2[a128][a256]",

    "-map", "[a128]",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_segment_filename", join(dir128, "seg_%05d.m4s"),
    "-hls_fmp4_init_filename", "init.mp4",
    join(dir128, "index.m3u8"),

    "-map", "[a256]",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_segment_filename", join(dir256, "seg_%05d.m4s"),
    "-hls_fmp4_init_filename", "init.mp4",
    join(dir256, "index.m3u8"),
  ];

  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  await writeFile(join(outDir, "master.m3u8"), MASTER_PLAYLIST, "utf8");

  return {
    hlsRelPath: `hls/${sha256}/master.m3u8`,
    loudnessI: null,
    loudnessTp: null,
  };
}
