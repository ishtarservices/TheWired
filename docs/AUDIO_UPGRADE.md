# Audio Platform Upgrade — Change Summary & Runbook

Delivered as a single mass-shipped changeset (four logical PR-sized chunks). **As of the latest revision, transcoding + HLS playback are flipped ON by default** in `docker-compose.prod.yml`. Every failure mode falls back to the existing original-URL path, so the worst case on a bad deploy is "no speedup" — not "no playback." Flags remain env-overrideable for fast rollback.

---

## 1. What changed

### PR 1 — Parallel album uploads (client-only)

| File | Change |
|---|---|
| `client/src/lib/concurrencyPool.ts` | **New**. Generic bounded-concurrency pool. `runWithConcurrency(tasks, maxInFlight)` settles all tasks, preserves input order, isolates per-task errors. No new dep. |
| `client/src/lib/__tests__/concurrencyPool.test.ts` | **New**. 5 unit tests: order preservation, error isolation, concurrency cap, empty input, invalid param. |
| `client/src/features/music/CreateAlbumModal.tsx` | Replaced the sequential `for` loop (lines 255-327) with a concurrency-3 pool. Order preserved via pre-allocated indexed buffer. Per-track audio + cover upload runs as `Promise.all`. Progress bar now reflects completed count. |
| `client/src/features/music/UploadTrackModal.tsx` | Audio + cover uploads run as `Promise.all`. |

Signer calls are **intentionally not parallelized at the caller**. `signAndPublish` already serializes signing internally via `signingQueue`, so multiple parallel `signAndPublish` calls queue at the signer and parallelize at the relay publish step — which is what we want.

### PR 2 — Ops preflight (config-only, behaviour-neutral)

| File | Change |
|---|---|
| `services/backend/src/config.ts` | Added `transcodeEnqueue`, `transcodeWorker`, `transcodeConcurrency` (default 1). |
| `docker-compose.prod.yml` | Backend memory `512m → 1.5g`. Dropped `cpus: "2.0"` (no-op on 2-vCPU host). Added `TRANSCODE_ENQUEUE`, `TRANSCODE_WORKER`, `TRANSCODE_CONCURRENCY` env vars. **ENQUEUE and WORKER default to `true`**; concurrency defaults to `1`. |
| `.gitignore` | Added `!services/backend/src/scripts/` negation so the transcode-backfill CLI at `services/backend/src/scripts/backfillTranscodes.ts` is actually committed and shipped in the backend image. Global `scripts/` ignore still excludes top-level seed/demo scripts. |

### PR 3 — Transcoding pipeline (backend, flags OFF)

| File | Change |
|---|---|
| `services/backend/Dockerfile` | `apt-get install -y ffmpeg` in the runtime stage. Image grows ~140 MB. |
| `services/backend/package.json` | Added `bullmq ^5.34.0` (locked to `5.75.2`). |
| `services/backend/src/db/migrations/0020_transcode_columns.sql` | **New**. 6 new columns on `app.music_uploads` (`transcode_status`, `hls_master_path`, `loudness_i`, `loudness_tp`, `transcoded_at`, `transcode_error`), a CHECK constraint on the status enum, and a partial index on the hot status subset. The existing `status` (active/deleted) column is untouched. |
| `services/backend/src/db/schema/music.ts` | Drizzle table extended with the new columns. |
| `services/backend/src/lib/transcode.ts` | **New**. Pure ffmpeg wrapper. Single invocation with `loudnorm` → `asplit` → dual AAC HLS ladder (128 + 256 kbps, fMP4, 6s segments). Hand-writes the master playlist. Purges the output dir on any error. No fluent-ffmpeg (deprecated). |
| `services/backend/src/lib/queue.ts` | **New**. BullMQ `Queue<TranscodeJobData>` singleton with `jobId: sha256` dedup, 3 retries, exponential backoff, bounded completed/failed history. |
| `services/backend/src/workers/transcodeWorker.ts` | **New**. BullMQ `Worker` that drives the pipeline: `pending → processing → ready/failed`. Concurrency from config. Returns `{ stop(): Promise<void> }` matching the existing worker pattern. |
| `services/backend/src/routes/hls.ts` | **New**. Fastify plugin: master playlist (status-gated), media playlists per rendition, segments (`seg_*.m4s`) and init (`init.mp4`) with `Cache-Control: public, max-age=31536000, immutable`. Playlists get `max-age=60`. |
| `services/backend/src/scripts/backfillTranscodes.ts` | **New**. CLI for one-shot bulk re-enqueue of pending transcodes. Runs in `dist/scripts/backfillTranscodes.js` after build. Throttled at 2/sec. Re-runnable (sha-dedup). |
| `services/backend/src/services/musicService.ts` | `uploadAudio`: enqueue transcode job if `config.transcodeEnqueue`. `deleteMusic`: also `rm -rf blobs/hls/<sha>` when the last owner is purged. |
| `services/backend/src/routes/music.ts` | New `GET /music/variants/:sha` (public) returns `{ status, hlsMaster?, loudnessI? }`. New `POST /music/admin/transcode-backfill` (admin-gated by `ADMIN_PUBKEYS`) enqueues up to 1000 pending rows per call. |
| `services/backend/src/routes/health.ts` | When either transcode flag is on, `/health` additionally returns `{ transcode: { pending, processing, ready, failed, ... } }`. |
| `services/backend/src/server.ts` | Registers `hlsRoutes` with prefix `/hls` — **before** `blossomRoutes` so the Blossom catch-all doesn't shadow. |
| `services/backend/src/index.ts` | Conditional `startTranscodeWorker()` when `config.transcodeWorker`. Shutdown handler awaits each worker's `stop()`, then `closeTranscodeQueue()`, then `server.close()`. |

### PR 4 — Client HLS playback

| File | Change |
|---|---|
| `client/src/lib/api/music.ts` | Added `getAudioVariants(sha256)` and types. Network-failure-safe (returns `null` on any error). |
| `client/src/features/music/useAudioPlayer.ts` | Player now fetches variants in parallel with the cache check. Playback path is chosen: **cache → native HLS → hls.js MSE → original URL**. `hls.js` is dynamically imported (kept out of the main bundle — Safari/Tauri-macOS never pay the cost). Fatal HLS errors silently degrade to original URL + auto-resume. Gated by `VITE_PREFER_HLS` (default on). On `canplaythrough`, **prefetches the next queued track** — for HLS that's master + media playlist + init + first segment; for progressive it's the first 128 KB via `Range`. Uses `priority: "low"` so it never competes with the current track's buffering. Aborted on skip/track-change. Closes the inter-track gap without spinning up a second audio element. |

**Not shipped in this session** (all cleanly deferrable):
- PR 5 — Auto-cache on play + LRU eviction
- PR 6 — Cloudflare cache rules + ARCHITECTURE.md update
- Service Worker (optional polish)
- Two-pass loudnorm (single-pass is v1)
- Progressive m4a fallback (HLS-only ladder in v1)

---

## 2. Setup requirements

### Local dev

```bash
pnpm install                 # picks up bullmq
pnpm dev:infra               # postgres, redis, meilisearch
```

If you want to run the transcoder locally (to test the pipeline end-to-end):

```bash
# macOS
brew install ffmpeg
# Debian/Ubuntu
sudo apt-get install -y ffmpeg

# then:
TRANSCODE_WORKER=true TRANSCODE_ENQUEUE=true pnpm dev:backend
```

### Environment variables

**Backend:**
- `TRANSCODE_ENQUEUE` (default **`true`** in prod compose, `false` in source config) — new uploads add a transcode job.
- `TRANSCODE_WORKER` (default **`true`** in prod compose, `false` in source config) — this process runs the BullMQ consumer.
- `TRANSCODE_CONCURRENCY` (default `1`) — concurrent ffmpeg jobs. See cost note below before raising.
- `ADMIN_PUBKEYS` — comma-separated hex pubkeys allowed to call `POST /music/admin/transcode-backfill` (existing var).

> The source-level defaults in `config.ts` stay `false` so `pnpm dev:backend` is opt-in locally. The prod `docker-compose.prod.yml` defaults flip them on — `docker compose up` in prod runs the full pipeline.

**Client (build-time Vite):**
- `VITE_PREFER_HLS=false` — optional kill switch. If set, the client never calls `/music/variants` and always plays the original imeta URL.

---

## 3. Production rollout (single deploy)

This is **mass-shipped in one deploy**. The flag defaults in `docker-compose.prod.yml` are `true`, so the transcode pipeline starts working the moment the new container boots. No "flip the flag" step — you either deploy the lot or you don't.

**Before you deploy:**

1. **Resize EBS to 100 GB** (HLS output roughly doubles your storage need):
   ```bash
   aws ec2 modify-volume --volume-id vol-<xxx> --size 100
   # wait for state to be 'optimizing' or 'completed', then:
   ssh ec2-user@<host>
   sudo growpart /dev/nvme0n1 1
   sudo resize2fs /dev/nvme0n1p1   # or xfs_growfs for XFS
   df -h /
   ```
2. **Sanity-check prod memory headroom**:
   ```bash
   ssh ec2-user@<host>
   free -h              # total should show ~7.5 GiB available on t4g.large
   docker stats --no-stream | awk 'NR==1 || $1 ~ /backend|postgres|redis/'
   ```
   The backend container is about to jump from 512 MB to 1.5 GB. Confirm you have room.

**The deploy itself:**

3. Push the image, `docker compose pull && docker compose up -d`. The image gets ~140 MB larger (ffmpeg apt install). Migration `0020` runs on boot.
4. **Verify**:
   ```bash
   curl -s https://api.thewired.app/health | jq
   # expect: { "status": "ok", "transcode": { "pending": N, "processing": M, "ready": 0, "failed": 0 } }
   ```
5. **Smoke-test one track** — upload a small `.wav` or `.aiff` via the client. Watch:
   ```bash
   docker compose logs -f backend | grep transcode
   # expect: [transcode] job <sha> completed in <N>ms
   curl -I https://api.thewired.app/hls/<sha>/master.m3u8
   # expect: 200, Cache-Control: public, max-age=60
   ```
6. **Backfill existing catalog** (optional, off-peak):
   ```bash
   curl -X POST https://api.thewired.app/api/music/admin/transcode-backfill \
     -H "Authorization: Nostr <base64-nip98-event>"
   # re-run until the response reports 0 enqueued.
   ```
   Or run the CLI directly inside the container:
   ```bash
   docker compose exec backend node dist/scripts/backfillTranscodes.js
   ```

**Monitor for the first 24 hours** (via `/health`, `docker compose logs`, and CloudWatch):
- `transcode_status.failed` should stay near zero — a small tail is normal (bad files).
- EBS used % — don't cross 80%.
- CPU credit balance (t4g.large) — should not fall below ~30% during normal ops. A brief dip during backfill is expected; a sustained drop means concurrency is too high.
- Redis `used_memory_peak` — should stay far below 256 MB.

### Cost notes (t4g.large, ARM, burstable)

- **CPU credits** replenish at baseline (~30% per vCPU combined). Sustained transcode at concurrency ≥ 2 will drain credits in ~30 min.
- Keep `TRANSCODE_CONCURRENCY=1` as default. Bump to 2 only during explicit backfill windows, and watch CPU credit balance in the EC2 console.
- If you routinely run out of credits, enable **Unlimited** credit mode on the instance (AWS console → Instance actions → Change credit specification). It's about $0.05/vCPU-hr extra when credits are depleted — still cheaper than upgrading to `m6g.large`.
- EBS `gp3` at 100 GB ≈ $8/month. Plan for S3 offload for cold blobs above ~70 GB used (out of scope for this change).

---

## 4. What to test

### Automated coverage (already locked in)

Running `pnpm --filter @thewired/client test` and `pnpm --filter @thewired/backend test` (infra via `pnpm dev:infra`) exercises:

- **`concurrencyPool`** — order preservation across mixed latencies, per-task error isolation, max-in-flight invariant, empty-input base case, invalid-param rejection (`client/src/lib/__tests__/concurrencyPool.test.ts`).
- **`getAudioVariants`** — parses ready + pending payloads, swallows 5xx and network errors to return null (so the player falls back silently), rejects invalid sha input without hitting the network (`client/src/lib/api/__tests__/music.test.ts`).
- **`transcode.ts`** — ffmpeg arg vector carries `loudnorm=I=-14:LRA=11:TP=-1`, `asplit=2[a128][a256]`, fMP4 HLS outputs at 6s segments for both 128k and 256k renditions; master playlist is written after ffmpeg returns and names both variants + the AAC-LC codec; partial output is purged on ffmpeg failure so retries start clean; the sha256 arg actually controls the output directory name (`services/backend/src/lib/__tests__/transcode.test.ts`).
- **`/hls/*` routes** — serves the master playlist with `max-age=60` when `transcode_status='ready'`; 404s a pending upload, unknown sha, or malformed sha; segment routes carry `max-age=31536000, immutable`; rejects unknown renditions, path-traversal attempts in the segment name, and arbitrary filenames that aren't `seg_NNNNN.m4s` or `init.mp4` (`services/backend/test/routes/hls.test.ts`).

The sections below are the **manual** checks that aren't worth automating (browser integration, ffmpeg binary behavior, end-to-end upload flow).

### Client — parallel uploads (PR 1)

1. **Multi-track album, public**: open Create Album modal, drop 5 mp3s at once.
   - Network tab should show **up to 3 concurrent** PUTs to `/music/upload`.
   - Resulting album event's `a` tags must match the modal's on-screen order (not completion order).
   - All 5 show "Done" in the modal.
2. **Mixed success**: rename a `.txt` to `.mp3` and include it with 4 valid files.
   - Bad file shows `Upload failed` inline.
   - Other 4 complete, album publishes with the 4 successful `a` refs.
3. **Single track upload modal**: pick audio + cover, check Network tab — they should fire concurrently, not one-after-the-other.
4. **Private album**: verify private uploads still work (signer queue serializes signing; uploads parallelize).

### Backend — transcoding pipeline (PR 3; needs `TRANSCODE_WORKER=true`)

1. Upload a `.wav` — DB row `music_uploads.transcode_status` should transition `pending → processing → ready` within a few seconds.
2. On-disk layout check:
   ```
   blobs/hls/<sha>/master.m3u8
   blobs/hls/<sha>/128k/{init.mp4, seg_00000.m4s, seg_00001.m4s, index.m3u8}
   blobs/hls/<sha>/256k/{init.mp4, seg_00000.m4s, seg_00001.m4s, index.m3u8}
   ```
3. `curl -I /hls/<sha>/master.m3u8` → 200, `Cache-Control: public, max-age=60`.
4. `curl -I /hls/<sha>/128k/seg_00000.m4s` → 200, `Cache-Control: ..., immutable`.
5. `ffprobe` loudness: decode either rendition and confirm integrated LUFS is within ±0.5 of −14.
6. Upload `.aiff`, `.flac`, `.wav` — all should transcode successfully.
7. **Force failure**: feed a non-audio file (e.g. image mislabeled as audio). `transcode_status` lands on `failed`, `transcode_error` populated. Worker process does not crash.
8. **Worker restart mid-job**: kill the backend with `docker kill -s SIGTERM`. Restart. BullMQ retries (up to 3 attempts with exponential backoff). Job eventually completes or fails cleanly.

### Client — HLS playback (PR 4)

1. **Track with `transcode_status=ready`**:
   - Chrome/Firefox: Network tab shows `.m3u8` + a stream of `.m4s` segment requests (hls.js, MSE).
   - Safari (web and Tauri macOS): one `.m3u8` request, no m4s fetches visible (native HLS).
   - Start play → skip to next track → skip back. No stalls, no double audio, no orphan requests after skip.
2. **Track with `transcode_status=pending`** (freshly uploaded): client falls back to the original URL silently.
3. **Track with no sha** (old imported events): variants lookup is skipped entirely. Original URL plays.
4. **`VITE_PREFER_HLS=false` build**: confirm Network tab never hits `/music/variants` and HLS routes are never requested.
5. **Offline / CDN down**: simulate 5xx on `/music/variants` (mock or `hosts` block) — player continues with original URL, no user-visible error.

### Delete path

1. Delete a track that owns a unique blob (no other owners). Verify:
   - `music_uploads` row gone.
   - `blobs/<sha>.<ext>` gone on disk.
   - `blobs/hls/<sha>/` tree gone on disk.
   - `GET /hls/<sha>/master.m3u8` → 404.
2. Delete a track whose blob has another owner. Verify the raw blob and HLS output **stay** (still referenced).

---

## 5. Edge cases & known behaviour

1. **Same audio uploaded twice by different users** — sha256 dedup means one blob, one transcode job (via BullMQ `jobId: sha256`). The second uploader's row inherits the existing `transcode_status` once the job completes.
2. **User skips tracks while HLS is initializing** — `loadedTrackId` guards in `useAudioPlayer` prevent stale loads from hijacking the current playback.
3. **HLS fatal error mid-playback** — hls.js error handler tears down, swaps `el.src` to the original URL, resumes playback. User hears a brief gap at most.
4. **`/music/variants` returns 404 / times out / 5xx** — `getAudioVariants` catches everything and returns null; player falls back to original URL.
5. **Old events lacking imeta `x` hash** — variants lookup is skipped (`primaryHash === null`). Plays original URL. No regression from today's behaviour.
6. **Private-event blob sha collision with a public event** — HLS output serves publicly (matching the existing Blossom threat model for space-scoped blobs; see `blossom.ts:26-29`). Accepted for v1.
7. **Worker restart during a job** — BullMQ retries up to 3 times with 5s exponential backoff. Partial on-disk output is purged in `transcode.ts`'s catch block so each attempt starts clean.
8. **SIGTERM during transcode** — `startTranscodeWorker().stop()` awaits in-flight jobs to drain before the Fastify server closes. No orphaned `processing` rows.
9. **Disk full / ffmpeg OOM / bad output / Redis pressure** — job fails, `transcode_error` is set to the truncated ffmpeg stderr, client falls back to original URL. See the dedicated section below for concrete triggers.
10. **Browser with neither native HLS nor MSE** — falls back to original URL. Essentially no one in 2026, but defensive.
11. **Cover upload fails mid-album** — non-fatal by design. Track still publishes, using the album cover (or no cover) in place of its per-track art.
12. **Concurrent delete + transcode** — if the track is deleted while its transcode is in flight, the worker's DB update affects 0 rows (row is gone). HLS output files remain until the blob itself is purged by the delete logic. Minor cleanup gap — acceptable.
13. **t4g.large CPU credit depletion** — API response times can grow during sustained transcode load. Mitigate by keeping concurrency at 1 and running backfill off-peak.
14. **Migration 0020 re-run** — all statements are idempotent (`IF NOT EXISTS`, conditional CHECK constraint block). Safe to re-run.
15. **Client `hls.js` chunk load failure** (e.g. CSP misconfig) — caught, falls back to original URL with a `console.warn`.

---

## 6. Failure triggers — are they real? What sets them off?

Short answer: **real but bounded**. The worst case on any of these is "that track falls back to the original URL and plays normally." Here's what each can concretely be triggered by on a t4g.large, 1.5 GB container, single-concurrency worker.

### ffmpeg OOM (real, narrow window)

Base memory for the encoder pipeline (`loudnorm` filter + `asplit` + two AAC encoders) sits at ~80–150 MB per job. With `TRANSCODE_CONCURRENCY=1` and a 1536 MB container limit, we're nowhere near the limit on ordinary music files.

**What does push it over:**
- **Pathologically large uncompressed input** — a 60-min WAV at 192 kHz / 32-bit float is ~2.6 GB on disk. ffmpeg decodes lazily (streaming), so RAM stays bounded, but the temp file copy and `loudnorm`'s LRA window can spike. Mitigation: `MAX_BLOB_SIZE` caps uploads at 100 MB by default, which rules out anything worse than a ~9 min 24-bit WAV.
- **Corrupt headers** — ffmpeg occasionally over-allocates when probing broken containers. Mitigation: `-loglevel error` + the execFile `maxBuffer: 16 MB` ceiling. On buffer overflow the job fails cleanly.
- **Concurrency bump during spike** — if you raise `TRANSCODE_CONCURRENCY=2` and two bad jobs coincide, you could approach the 1.5 GB cap. Keep at 1 under normal ops.

**Signal:** container killed with exit 137 (OOMKilled) in `docker logs`. BullMQ retries the job up to 3× with exponential backoff; if all fail, row lands on `transcode_status='failed'` and stays there.

### Bad output (real, mainly for exotic inputs)

ffmpeg returning exit 0 does not mean the output is useful. What can produce broken-but-no-error HLS:
- **Near-silent or zero-duration inputs** — `loudnorm` has edge cases on silence; output may be 0-byte segments.
- **Inputs with weird sample rates** (e.g. 44.1 kHz → 48 kHz resample chain on a short file) — rare stalls.
- **Mismatched `mimetype` vs actual content** — client sent `audio/wav` but file is actually FLAC in a WAV container. ffmpeg usually copes; occasionally produces a valid-looking master but broken media playlists.

**Signal:** `/hls/<sha>/master.m3u8` returns 200 but the player fails to decode (hls.js dispatches `MEDIA_ERROR` fatal). The client's error handler tears down and plays the original URL — the user never sees a broken state, but Sentry/logs will show `[hls] fatal error` warnings. If you see a consistent pattern, grep `transcode_error` for the offending shas.

**Mitigation if it becomes a problem:** add a post-transcode size sanity check in `transcodeWorker.ts` — if `seg_00000.m4s < 1 KB` mark as `failed`. Not shipped in v1; add if you see it.

### Redis pressure (real but unlikely at current scale)

Redis in prod runs with `--maxmemory 256mb --maxmemory-policy allkeys-lru`. BullMQ stores jobs as hashes + a pending list. A job hash is ~2 KB serialized.

**What could fill it:**
- **Huge upload burst** — 10k tracks in one batch. 10k × 2 KB = 20 MB. Still fine.
- **Worker offline for a long time while enqueue continues** — `TRANSCODE_WORKER=false` but `TRANSCODE_ENQUEUE=true`. Jobs pile with no consumer. At sustained upload rate this is still 10s of MB per 10k jobs. Mitigation: don't run that config mismatch.
- **Redis competing with the rest of the app** — chat ephemeral state, rate-limit sliding windows, search caches. If Redis ever gets tight, `allkeys-lru` will evict *something* — BullMQ includes dedup keys, and evicted jobs will simply re-run (idempotent due to `jobId: sha256`).

**Signal:** `redis-cli info memory` → `used_memory_peak` trending toward 256 MB, or BullMQ warnings about evicted keys. Monitor via CloudWatch custom metric if it becomes a concern.

**Mitigation:** `queue.ts` sets bounded history (`removeOnComplete: 1000, removeOnFail: 5000`). Failed jobs aren't retained forever.

### TL;DR — what should make you intervene

| Signal | What it means | What to do |
|---|---|---|
| `docker logs` shows `exit 137` on the backend container | ffmpeg OOMKilled | Check the offending sha's original file size; keep concurrency=1 |
| `/health` shows `failed > 10%` of `total` | Pipeline has a systematic problem | Grep `transcode_error` in DB for a common stderr; pause enqueue |
| Repeated `[hls] fatal error` in client logs for the same sha | Bad output | Mark that row `failed`, investigate the source file |
| `redis-cli info memory` trending toward 256 MB | Redis pressure | Raise Redis maxmemory temporarily; check for non-transcode key spam |

---

## 7. Rollback switches

| Failure | Action | Effect |
|---|---|---|
| ffmpeg/worker misbehaves | Set `TRANSCODE_WORKER=false`, redeploy | No consumer runs. Jobs sit in Redis until re-enabled. |
| Transcoded output is bad | Set `TRANSCODE_ENQUEUE=false`, redeploy | New uploads stop enqueueing. Existing data unaffected. |
| Client HLS broken | Build client with `VITE_PREFER_HLS=false`, re-release | Variants lookup + hls.js path is disabled. |
| Disk filling | Stop worker. Run a cleanup script to `rm -rf blobs/hls/<sha>` for least-popular tracks (no such script shipped yet — manual ops). | Space reclaimed. `GET /hls/*` returns 404 for purged shas. Variants endpoint still says `ready`; that's inconsistent but harmless — client falls back to original URL on the 404. |

HLS output lives in a dedicated `blobs/hls/` tree that never overlaps with raw blobs. It is always safe to delete the entire `blobs/hls/` directory — playback degrades to original URLs.
