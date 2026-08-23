import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock child_process BEFORE importing the module under test so promisify()
// captures the mocked execFile in its closure. The real execFile carries a
// util.promisify.custom implementation resolving { stdout, stderr } — mirror it,
// otherwise generic promisify resolves the bare stdout string.
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const fn = vi.fn();
  (fn as unknown as Record<symbol, unknown>)[promisify.custom] = (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      fn(...args, (err: Error | null, stdout?: string, stderr?: string) =>
        err ? reject(err) : resolve({ stdout, stderr }),
      );
    });
  return { execFile: fn };
});

import { execFile } from "node:child_process";
import { transcodeAudio } from "../transcode.js";

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

/**
 * `promisify(execFile)` expects the wrapped function to use Node's standard
 * execFile callback signature `(error, stdout, stderr)` — it unwraps that
 * into a Promise that resolves with `{ stdout, stderr }` or rejects with
 * the error. The callback is always the last argument; ffmpeg is invoked with
 * an options object and ffprobe without, so find it positionally.
 */
function mockSuccess(stdout = "") {
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as
      (e: Error | null, stdout?: string, stderr?: string) => void;
    cb(null, stdout, "");
  });
}

function mockFailure(msg = "ffmpeg died") {
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as (e: Error | null) => void;
    cb(new Error(msg));
  });
}

describe("transcodeAudio", () => {
  let blobDir: string;
  const sha = "a".repeat(64);
  let inputPath: string;

  beforeEach(async () => {
    blobDir = await mkdtemp(join(tmpdir(), "transcode-test-"));
    inputPath = join(blobDir, "input.wav");
    await writeFile(inputPath, Buffer.alloc(16));
    execFileMock.mockReset();
  });

  afterEach(async () => {
    await rm(blobDir, { recursive: true, force: true }).catch(() => {});
  });

  it("invokes ffmpeg with loudnorm, asplit, and two HLS outputs", async () => {
    mockSuccess("123.45\n");
    const result = await transcodeAudio({ inputPath, sha256: sha, blobDir });
    expect(result.hlsRelPath).toBe(`hls/${sha}/master.m3u8`);
    // Second invocation is the ffprobe duration probe.
    expect(result.durationSec).toBeCloseTo(123.45);

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls[1][0]).toBe("ffprobe");
    const call = execFileMock.mock.calls[0];
    const cmd = call[0] as string;
    const args = call[1] as string[];
    expect(cmd).toBe("ffmpeg");

    const joined = args.join(" ");
    // Loudness target
    expect(joined).toContain("loudnorm=I=-14:LRA=11:TP=-1");
    // Single decode split to two encoders (no wasted CPU)
    expect(joined).toContain("asplit=2[a128][a256]");
    // Both renditions present
    expect(joined).toContain("128k");
    expect(joined).toContain("256k");
    // fMP4 segments (init.mp4 + .m4s) at 6-second granularity
    expect(args).toContain("-hls_segment_type");
    expect(args).toContain("fmp4");
    expect(args).toContain("-hls_time");
    expect(args).toContain("6");
    // VOD playlist type (not event/live)
    expect(args).toContain("-hls_playlist_type");
    expect(args).toContain("vod");
    // Segment filenames land in the right directories
    expect(joined).toContain(`hls/${sha}/128k/seg_%05d.m4s`);
    expect(joined).toContain(`hls/${sha}/256k/seg_%05d.m4s`);
    expect(joined).toContain(`hls/${sha}/128k/index.m3u8`);
    expect(joined).toContain(`hls/${sha}/256k/index.m3u8`);
  });

  it("writes a master playlist listing both variants after success", async () => {
    mockSuccess();
    await transcodeAudio({ inputPath, sha256: sha, blobDir });

    const master = await readFile(join(blobDir, "hls", sha, "master.m3u8"), "utf8");
    expect(master).toContain("#EXTM3U");
    expect(master).toContain("#EXT-X-VERSION:7");
    expect(master).toContain("128k/index.m3u8");
    expect(master).toContain("256k/index.m3u8");
    // AAC-LC signature — what hls.js / native expect for mp4a audio streams
    expect(master).toContain("mp4a.40.2");
  });

  it("cleans up the HLS output dir when ffmpeg fails", async () => {
    mockFailure();
    await expect(
      transcodeAudio({ inputPath, sha256: sha, blobDir }),
    ).rejects.toThrow();

    // A retry should start from a clean slate — assert the dir is gone
    await expect(access(join(blobDir, "hls", sha))).rejects.toThrow();
  });

  it("uses the sha256 input as the output directory name", async () => {
    mockSuccess();
    const other = "b".repeat(64);
    await transcodeAudio({ inputPath, sha256: other, blobDir });

    const args = execFileMock.mock.calls[0][1] as string[];
    const joined = args.join(" ");
    expect(joined).toContain(`hls/${other}/128k`);
    expect(joined).not.toContain(`hls/${sha}/`);
  });
});
