# Ranking & Recommendation — analysis of `xai-org/x-algorithm` against The Wired

Status: analysis only. Nothing here is implemented.
Source reviewed: [`xai-org/x-algorithm`](https://github.com/xai-org/x-algorithm) (Apache-2.0), the
open-sourced X "For You" feed stack.

---

## 0. Read this part first

X's architecture assumes the ranker sees the whole corpus. **Ours cannot.**

`services/backend/src/workers/relayConnectionManager.ts:141-160` subscribes to the broad kind set
**only on our own relay**:

```ts
if (isOwn(url)) {
  ws.send(JSON.stringify(["REQ", "ingester",
    { kinds: [0,1,5,7,9,22,30023,34236,31683,33123,30119,31685,9735,9021,9022,39000], since }]));
  ...
}
// External relay: subscribe ONLY to the registered spaces' chat + metadata.
ws.send(JSON.stringify(["REQ", "ext-chat", { kinds: [9, 7], "#h": ids, since }]));
ws.send(JSON.stringify(["REQ", "ext-meta", { kinds: [39000, 39002], "#d": ids }]));
```

So `relay.events` **is `relay.thewired.app` and nothing more**. The backend cannot see a kind:1 that
someone you follow posted to `damus.io` or `nos.lol`. It does not subscribe to kind:3 at all, so it
has no follow graph beyond what happens to land on our relay.

The client's corpus is the opposite shape — `groupSubscriptions.ts:380-411` subscribes
`{ authors: follows, kinds }` across *every* read relay the user has.

**Consequence: for social content, the client's Friends Feed is structurally better-informed than
any backend ranker could be.** Any backend-side social ranking inherits a small, non-representative
slice of the network. This single fact removes most of what looks borrowable from the X repo on a
first read, and it is the reason this document exists — otherwise it gets re-litigated every time
someone opens that repo.

The transferable value is concentrated where **we own the corpus**: music and space discovery.

---

## 1. What we have today

Three ranking systems. The one that matters most is unreachable from the UI.

| System | Where | Formula | Cadence |
|---|---|---|---|
| Event trending | `workers/trendingComputer.ts:188-192` | `zapCount*10 + reactions*3 + plays*2 + comments*5 + log2(zapSats)*2`, × decay | 30 min |
| Space discovery | `services/discoveryService.ts:635-660` | `members*2 + active24h*5 + msgs24h + zapCount24h*10 + log2(sats)*2 + newness step` | 15 min |
| "Personalized" feed | `services/feedService.ts:74-110` | trending top-200 → drop mutes → `score * 6` if followed | 1 h Redis TTL |

Time decay, `trendingComputer.ts:60-63` — a soft power law, ~24 h scale:

```ts
function timeDecay(createdAt: number): number {
  const hoursSince = (Date.now() / 1000 - createdAt) / 3600;
  return 1 / Math.pow(1 + hoursSince / 24, 1.5);
}
```

**The client has no ranking at all.** Every feed is one line of reverse-chronological sort
(`features/spaces/spaceSelectors.ts:68-79`, `MediaFeed.tsx:778-780`, `LongFormView.tsx:39`).
Reactions and zaps *are* collected client-side but only ever render a count on a card — they never
enter an ordering decision. Client-side personalization is entirely *subtractive*: mutes, local
hides, muted words (`features/friends/feedVisibility.ts:27-36`).

**`getPersonalized` has zero callers.** Defined in `client/src/lib/api/feeds.ts`, re-exported from
`lib/api/index.ts`, called from nowhere. And its candidate generation is inverted — it *filters* the
global trending 200 rather than generating from the follow graph, so a post from someone you follow
that isn't globally trending is unreachable:

```ts
// feedService.ts:98-101
let boost = 1;
if (follows.has(author)) boost = 6;
scored.push({ eventId: item.eventId, score: item.score * boost });
```

---

## 2. How X does it

Two pipelines. The **Post Pipeline** finds, ranks and filters; the **Blending Pipeline** adds ads,
Who-to-Follow and prompts. Stages: query hydration → candidate sources (parallel) → candidate
hydration → pre-scoring filters → scoring → top-K selection → post-selection filters.

Candidate sources: `thunder/` (in-network, recent posts from follows, held in memory),
`phoenix/` retrieval (embedding similarity, out-of-network), `simclusters/` (community clustering).

Scoring, `home-mixer/scorers/ranking_scorer.rs`:

```
Final Score = Σ (weight_i × P(action_i))
```

`phoenix/` predicts a probability per action — favourite, reply, repost, quote, share, clicks, dwell,
follow-author, and negatives (not-interested, mute, block, report, not-dwelled). Production defaults
from `home-mixer/params/param.rs`:

| Positive | | Negative | |
|---|---|---|---|
| `reply` | 5.0 | `report` | −234.0 |
| `quote` | 5.0 | `mute_author` | −58.8 |
| `share_via_dm` | 5.0 | `not_interested` | −43.2 |
| `share_via_copy_link` | 20.0 | `block_author` | −31.2 |
| `follow_author` | 4.0 | `not_dwelled` | −0.02 |
| `share` | 2.0 | | |
| `retweet` | 1.0 | | |
| `favorite` | 0.5 | | |
| `click` | 0.4 | | |
| `dwell` | 0.05 | | |

Plus `bidirectional_follow_reply_weight_boost = 15.0` for replies between mutual follows.

Three post-hoc adjustments (`ranking_scorer.rs:561-563`, `:592-614`):

```rust
fn diversity_multiplier(decay_factor: f64, floor: f64, exponent: f64) -> f64 {
    (1.0 - floor) * decay_factor.powf(exponent) + floor
}
```

- **Author diversity** — `decay = 0.5`, `floor = 0.25`, exponent `k` = the author's rank-order
  occurrence index. Gives 1.0, 0.625, 0.4375, 0.34 … → 0.25.
- **Out-of-network discount** — `OonWeightFactor = 0.75` (`0.5` in topic feeds).
- **New-author boost** — `author_cold_start.rs`, Thompson sampling on a Beta posterior, bounded by
  follower cap, impression threshold, and post age.

Ranking and *visibility* are deliberately separate systems (their design decision #4): a labelling
path (`grox/`, `agatha/`, `bdsm/`, `user-cred-v2/` PageRank, `scarecrow/`) writes labels
asynchronously, and `visibility-filtering/` answers `ALLOW | INTERSTITIAL | DROP` per post/viewer
after ranking has already fixed the order.

---

## 3. Verdict on each idea

### 3.1 Survives

**Author diversity decay.** ~15 lines, applies to `trendingComputer` selection and discovery
ordering. We have no per-author cap anywhere, so one prolific zapped author can occupy the whole
top-100. The obvious objection — "at our scale nothing has engagement anyway, so `selectTrending`'s
cold-start fallback makes the list recency-ordered" — cuts the *other* way: a small corpus makes
single-author domination **more** likely, not less.

**Music co-listen recommendation.** The strongest item here, and it comes from reading our own code
rather than X's. We already collect the exact input:

- `redis listening_history:<pubkey>` — last 500 tracks per user, written on every play
  (`services/musicService.ts:532`). **Read by nothing.**
- `app.music_play_listeners` — a full user×track matrix. **Read by no ranker.**

And we have three dead output surfaces waiting for it:

- `routes/music.ts:314-322` — `/music/underground` and `/music/recommended` both `return { data: [] }`
  with `TODO: Phase 4` / `Phase 5`; the client wrappers (`client/src/lib/api/music.ts:303-311`) are
  stubs too.
- `musicSlice.discovery.undergroundTrackIds` / `recommendedTrackIds` — setters and cleanup, **no
  readers**.
- `newReleaseIds` — **readers but no writer**, so MusicHome's second rail silently degrades to the
  user's own library (`MusicHome.tsx:102`).

Item-item co-listen CF is a small, well-understood batch job in the existing worker style. The
corpus problem does not apply: **we host the music.**

**2nd-degree follow suggestions.** X's "Who to Follow". Already specified in
`docs/DISCOVER_REMAINING_PHASES.md` §5.5 — collect `p` tags from your follows' kind:3 events, count
occurrences, drop already-followed, sort. Pure client-side, no backend, no privacy cost, no corpus
problem. Fills the People tab, currently a "Coming soon" placeholder (`DiscoverPage.tsx:98-100`).

**Named constants.** Our coefficients are magic numbers inside SQL string literals
(`discoveryService.ts:635-660`). Extracting them to a module with named defaults is the only part of
X's `param.rs` idea that transfers at our size.

**Space discovery refinements.** Ours end-to-end, so improvements land. The newness term is a step
function (`+50` under 7 d, `+20` under 30 d, `0` after) with no decay for age; the decay curve
trending already uses is a better shape.

### 3.2 Cut

**A backend "For You" feed.** §0 kills it. The client already generates in-network candidates from
the full relay set; the backend can only see our relay. Even a correctly-written
`getPersonalized` — generating from follows instead of filtering trending — would be *worse* than
the Friends Feed the user already has. The open question on `/feeds/*` is whether it should exist,
not how to improve it.

**PageRank credibility (`user-cred-v2/`).** Tempting, and wrong on three counts: (1) the backend has
no follow graph — kind:3 isn't subscribed — so this needs a cross-relay k3 crawler first, a real
project in its own right; (2) a *global* credibility score computed by our backend is a centralized
reputation authority, against the point of the product; (3) the version that actually suits Nostr is
trust **rooted at the individual user**, computed client-side from their own graph — a different
algorithm with different properties, not a PageRank port.

**Cold-start Thompson sampling (`author_cold_start.rs`).** Thompson sampling updates a Beta posterior
from impressions. We have no impressions and won't by default. No impressions, no bandit. Also
over-engineered for our size: with a small item pool you reserve slots rather than solving
explore/exploit optimally — and `selectTrending`'s `MIN_ENGAGED_ITEMS = 10` recency fallback already
does a crude version of that.

**The `Source / Filter / Scorer / Selector` pipeline framework** (`candidate-pipeline/`). X has ~17
filters, three candidate sources, several scorers, and continuous A/B. We have two formulas and no
A/B framework. Building the abstraction for two formulas is premature. Revisit at five candidate
sources.

**Report-weighted negative signals.** X's `report = −234` works because reports are high-volume and
model-predicted. NIP-56 kind:1984 on Nostr is low-volume and unreliable, and `app.spam_reports` has
no writer. The negative signal that *is* real for us is space-scoped: `moderationService` bans
currently affect no score, so a banned user's content still trends. Small, well-scoped fix — not a
global reputation term.

**Opt-in engagement telemetry.** Telemetry that a small fraction of users enable yields a dataset too
sparse to rank on, while costing a full consent, settings, ingest and retention surface. Build the
consent mechanism when something concrete needs it; nothing on the surviving list does.

**"Under the Hood" transparency.** Good idea and on-ethos, but there is nothing to be transparent
about until a ranker exists.

**`phoenix/`, `vm-ranker/`, `simclusters/`, `grox/` + `clip/` + `media-model-proxy/`, ads blending.**
Wrong order of magnitude — a JAX transformer with a Kafka-fed retrieval index, DPP reranking over
embeddings, Scalding-scale Louvain clustering, a classifier fleet, and ad slotting we have no use
for. Worth keeping a *pluggable label interface* in mind so classifiers can be added later; not worth
building one now.

### 3.3 The one thing that must not be copied

X's weights multiply **predicted probabilities** from a trained model. Ours multiply **raw counts**.
Their README is emphatic about this, because the "one report cancels 468 likes" reading is wrong —
the weight scales *your predicted probability* of reporting, and the base rate of a report is ~1000×
lower than a like, which is the entire reason its weight is large.

Pasting X's numbers into our formulas would be a category error. They are usable only as evidence of
**relative ordering**: reply ≫ favourite, and negatives ≫ positives by roughly 100×.

---

## 4. Defects found during this review

These outrank every algorithm change above.

| # | Issue | Location |
|---|---|---|
| 1 | **`indexZapReceipt` is not idempotent** — a replayed kind:9735 receipt permanently inflates trending scores. `rollupSpaceZaps` resets to zero wholesale for exactly this reason; the trending path has no equivalent. Live score-gaming vector. | `workers/ingestHandlers.ts:310-318` vs `services/discoveryService.ts:584-633` |
| 2 | **Workers have no distributed lock** — bare in-process `setInterval`, so a second backend replica double-runs every job, including #1. | `src/index.ts:39-47` |
| 3 | **Meilisearch filter not escaped** — `searchService` interpolates `genre` / `hashtag` raw, while `musicService` escapes the identical two fields with `escapeMsFilter`. | `services/searchService.ts:92-93` vs `services/musicService.ts:371-372` |
| 4 | **`reactionsReceived` has two disagreeing writers** — one increments, the other zeroes. | `ingestHandlers.ts:299-307` vs `analyticsAggregator.ts:101` |
| 5 | `getTrending` silently ignores the `kind` param the route accepts. | `routes/feeds.ts:8`, `services/feedService.ts:7-27` |
| 6 | `trendingComputer` only ever computes the `24h` period, though `1h/6h/7d` are defined. | `workers/trendingComputer.ts:17-22`, `:73` |
| 7 | Kind:6 reposts and kind:1 replies are counted by nothing — only NIP-22 kind:1111 comments are. | `workers/trendingComputer.ts:132-141` |
| 8 | Friends Feed indexes **only while it is the active space**, so nothing accumulates in the background. | `lib/nostr/eventPipeline.ts:1065` |
| 9 | `FEED_INDEX_CAP = 500` retains the newest 500 *by insertion order* — a score-ordered feed cannot use this retention rule as-is. | `store/slices/eventsSlice.ts:99-101` |
| 10 | Dead surfaces: `/feeds/*` (no client callers), `app.reputation`, `app.spam_reports`, `app.space_feed_sources`, and the three `musicSlice.discovery` id lists. Wire or delete. | various |

---

## 5. Suggested sequence

1. **Correctness** — #1 through #4 above, then #5–#7. No ranking behaviour changes.
2. **Decide the dead surfaces** — for each item in #10: wire it or delete it.
3. **Music recommendation** — item-item co-listen CF over `music_play_listeners` / `listening_history`,
   filling `/music/underground`, `/music/recommended`, and the New Releases rail. Author/artist
   diversity decay on the result.
4. **Small ranking improvements where we own the corpus** — author diversity decay in
   `trendingComputer`; decay instead of the step bonus in the discovery score; space bans excluded
   from space-scoped ranking; constants to named params.
5. **People tab** — 2nd-degree follow suggestions per `DISCOVER_REMAINING_PHASES.md` §5.5.

Scorers and selectors should stay **pure functions with unit tests**, following the pattern already
set by `selectTrending` and `services/backend/test/workers/trendingComputer.test.ts` — no DB in
scoring tests.

---

## 6. The prior question

The interesting question is not "how much per-user signal should we collect" — it is **whether the
backend should ingest social content from the wider relay network at all**. Today it does not, which
caps backend social ranking regardless of how rich the signals get. That is a product and
decentralisation decision, not a ranking one, and it should be settled before anyone builds a feed
ranker on top of `relay.events`.
