# The Wired — AI Engine: Status & Next Steps

> Living status doc for the toggleable **AI** feature. Master design + phased plan:
> `.claude2/plans/cuddly-inventing-owl.md`. Memory pointer: `project_ai_engine.md`.
> Origin spec: `PACKAGES_DESIGN.md` §8.

## Scope (user-chosen, maximal)
Full engine stack incl. in-process · image **and** audio generation · full **gated-agentic** tool use ·
**local + keychain** storage (no Nostr sync).

## Engine strategy (decided)
Three tiers behind ONE OpenAI-compatible HTTP adapter:
1. **Reuse installed** — detect Ollama (`:11434`) / LM Studio (`:1234`).
2. **Managed** — `llama-server` download-on-enable (Phase 2). **mistral.rs is the deferred in-process tier (Phase 4)**, the Tauri-native fit; recommended upgrade = mac-Metal default-on / llama-server elsewhere.
3. **Cloud** — Claude / OpenAI / OpenRouter / DeepSeek / Kimi (BYO key).

Hardware "will it run?" is a TS heuristic we compute (sysinfo/wgpu/nvidia-smi give raw specs only); only relevant on the managed-engine path.

---

## ✅ DONE — Phase 0 (frontend-only, 1 capability line, no new Rust) + polish
Verified: `pnpm --filter @thewired/client typecheck` clean · 654 client tests pass · `vite build` clean.

### Architecture (mirror of the wallet triad)
```
AISettingsTab ──keys──▶ OS keychain (secretStore)
      ▼
llmManager.ts (singleton; Map<id,LLMProvider> + apiKeys in memory/keychain, NEVER Redux)
   loadProvidersForAccount(pubkey) / resetLLMManager()
      │ dispatch status                 │ chat() → AsyncIterable<ChatChunk>
      ▼                                 ▼
aiSlice (display+persisted state)   providers/* (openaiCompat · anthropic) via Tauri plugin-http
      │ write-through
      ▼
aiConversationStore.ts (IndexedDB v2: aiConversations + aiMessages, per-account)
```
Single streaming contract: every backend reduces to `ChatChunk`
(`text | reasoning | tool_call | image | audio | usage | error | done`). `streamRunner` throttles
deltas (~70ms), owns AbortControllers, writes the final message through to IDB.

### Files — NEW
- **Types/state:** `client/src/types/ai.ts`, `client/src/store/slices/aiSlice.ts`
- **DB:** `client/src/lib/db/aiConversationStore.ts`
- **Engine:** `client/src/features/ai/engine/{types,httpFetch,sse,thinkSplitter,providerCatalog,detectLocal,llmManager,streamRunner}.ts`, `engine/providers/{openaiCompat,anthropic}.ts`
- **Actions/prefs:** `client/src/features/ai/{conversationActions,aiPrefs,aiPrefsActions}.ts`
- **UI:** `client/src/features/ai/{AIProvider,AISidebar,AIChatView,AIMessageList,AIMessageBubble,AIComposer,AIModelPicker}.tsx`
- **Markdown:** `client/src/features/ai/markdown/{AIMarkdown,CodeBlock,safeUrl,repairMarkdown}.{tsx,ts}`
- **Settings:** `client/src/features/settings/AISettingsTab.tsx`
- **Tests:** `client/src/features/ai/__tests__/{aiSlice,sse,safeUrl,thinkSplitter,repairMarkdown}.test.ts`

### Files — MODIFIED
- Toggle: `store/slices/featuresSlice.ts` (`FEATURE_AI`), `features/settings/FeaturesSettingsTab.tsx`
- Store: `store/index.ts`, `__tests__/helpers/createTestStore.ts`
- DB: `lib/db/database.ts` (DB_VERSION 1→2, oldVersion-guarded upgrade)
- Secrets: `lib/nostr/secretStore.ts` (`llmApiKeySecret`, `llmProvidersKey`)
- Shell: `store/slices/uiSlice.ts` (`SidebarMode` += `"ai"`, exported), `components/layout/Sidebar.tsx` (gated tab + `AISidebar`), `app/App.tsx` (`MainContent` keep-alive `AIChatView`), `app/Layout.tsx` (`AIProvider`), `features/settings/SettingsPage.tsx` (gated `ai` tab), `hooks/useNavigationHistory.ts`
- Markdown theme: `index.css` (`.hljs` transparent override)
- Native: `src-tauri/capabilities/default.json` (added `http://localhost:*` + `127.0.0.1:*`)
- Deps added: `marked`, `remark-breaks`, `highlight.js`, `recharts` (lazy-loaded, code-split — chart artifacts only)

### Feature behavior shipped
- Toggleable **AI** tab (Settings → Features, default off), conversation list sidebar + chat center.
- Providers: **Detect local** + presets (Claude/OpenAI/OpenRouter/DeepSeek/Kimi/Ollama/LM Studio/Custom); keys in keychain; per-provider Test/Default-model; **Set as default** provider + "Default" badge.
- Model picker in **chat header** (always visible), grouped/sorted (default→connected→rest), works with no conversation (sets persisted default via `aiPrefsActions.setDefaultModelPref`).
- Streaming chat: **live block-memoized markdown** (marked Lexer split + per-block `memo`), `repairMarkdown` for incomplete tokens, `remark-breaks`, chat-tuned typography, code cards (language + copy, github-dark highlight).
- **Reasoning models**: `<think>` splitter + `reasoning_content`/Anthropic-thinking → collapsible "Thought for Ns" panel; gated by **Show reasoning** pref.
- **Token usage**: captured (OpenAI `stream_options.include_usage`, Anthropic usage) → optional per-message footer + tok/s (**Show token usage** pref).
- Per-message **copy** + **regenerate**; conversations persist per-account; logout clears.

### Contracts to preserve (don't break these)
- **Keys never in Redux** — only `llmManager` memory + keychain (`secretStore`). Slice holds non-secret config only. On the **web build**, `secretStore` keeps secrets in session memory by default (purged on logout); plaintext-localStorage persistence is an explicit risk-acknowledged opt-in (Settings → Security) — audit #95.
- All backends normalize to `ChatChunk`; UI/`streamRunner` never see provider-specific framing.
- AbortControllers + delta buffers live in `streamRunner` (module state), not Redux. The turn's AbortSignal threads through `ToolContext` into long-running tools (web-search fetches) — Stop/logout actually cancels the tool phase, and skipped calls get **cancelled stub results** so history stays provider-valid (audit #94).
- Streaming deltas are Redux-only; only the FINAL assistant message is persisted (`putMessage`). Zero-output error bubbles are NEVER persisted, and `buildEngineMessages` filters empty-text/no-toolCalls assistant messages + stubs orphan tool_calls — one empty message otherwise 400-bricks the whole conversation (audit #11/#12).
- `streamingByConversation` is **TURN-scoped** (set at the first `startAssistantMessage`, cleared only by `endTurn` in `runTurn`'s finally) — it must stay set through tool execution so `evictConversationMessages` can't wipe a conversation mid-turn (audit #12).
- `llmManager`/`webSearch` async paths re-check their **generation counter after every await**; `resetLLMManager` is called on logout AND feature-flag-off (audit #49/#96).
- Untrusted model output: `AIMarkdown` scheme-allowlists URLs (`safeUrl`), no `rehype-raw`/raw HTML.

---

## ✅ DONE — Phase 1 (Interop + Artifacts + Agentic; all frontend) + research pass
Verified: `pnpm --filter @thewired/client typecheck` clean · **754 client tests pass** (+100) ·
`vite build` clean (recharts code-split into its own lazy `ChartArtifact` chunk — NOT in the main bundle).
A recon workflow mapped every integration surface + ran 5 external best-practice research briefs +
a UX critique; the validated decisions below are baked into the implementation. Briefs are summarized
inline where they changed the design.

### 1a. Context injection ("Ask AI" → INTO the model) — `features/ai/context/`
- `AIContext { kind, label, text(≤8k snapshot), refs{eventIds,pubkeys,naddr,spaceId,channelId}, defaultInstruction, trust:"untrusted" }` in `types/ai.ts`; `aiSlice.pendingContext` + `setPendingContext` + `selectPendingContext`.
- `context/aiContext.ts` — builders (`buildNote/Thread/Profile/DMConversation/DMMessage/Space/Channel/SelectionContext`) read live Redux, drop muted authors, clamp; `frameUntrustedBlock`/`frameUntrustedContext` wrap snapshots as data (used by `streamRunner.buildEngineMessages` before the user's text). `context/sendToAI.ts` (sidebarMode "ai" + clear active conv + stage context, no premature empty chats) + `context/useAskAI.ts` (+ navigate). `context/AIContextChip.tsx`.
- Composer seeds the instruction + shows a dismissible chip; the user bubble shows the chip in history (`AIMessageBubble`). `sendUserMessage(id, text, context?)` attaches it; only the final assistant message yields artifacts.
- **Surfaces wired:** `dm/DMMessageContextMenu`, `dm/DMConversationContextMenu`, `chat/ChatMessageContextMenu`, `spaces/notes/NoteActionBar` (+ parents `spaces/NotesFeed`, `profile/NoteCard`), `profile/UserPopoverCard`, `profile/ProfilePage` (overflow), `spaces/SpaceContextMenu` ("Catch me up"), `spaces/ChannelContextMenu` ("Summarize channel"). _Remaining: `NoteThreadPage` overflow (minor)._
- **Chip preview:** `AIContext.preview` shows the actual content (truncated; image-only URLs → `🖼 image`) with the category as a caption; chips render content, not just a category label.

### 1b. Artifacts panel (OUT / rich rendering) — `features/ai/artifacts/` + right-panel wiring
- Right panel wired: `uiSlice` `PanelContext += "ai"` + defaults; `useRightPanelContext` `AI_TABS` + `sidebarMode==="ai"→"ai"`; `RightPanel` title/icon + `<ArtifactsPanel/>` mount.
- **Convention (research: artifacts-canvas brief → LibreChat/Claude in-band directive + fenced fallback):** `parseArtifacts.ts` recognizes fenced ` ```chart `/` ```table `/` ```document `, large code fences (≥15 lines), AND a `:::artifact{type title}` directive — model-agnostic (works for dumb local models). Returns ordered prose/artifact **segments**; the bubble renders prose as markdown and artifacts as inline **chips** (`ArtifactChip`) that open the canvas.
- Artifacts are a **deterministic projection of message text** (`artifactSync.ts`, id=`${messageId}#${i}`) — extracted on stream completion AND on hydration, so they survive reload with NO new IDB store (message text stays canonical).
- Renderers (`ArtifactRenderer`): document/code → `AIMarkdown`; **chart → lazy `ChartArtifact` (recharts)** from a hand-rolled, bounded, **palette-index-only** `chartSpec.ts` (no zod; clamps series/points/labels, rejects raw colors/CSS — research: recharts-safety brief); table → `TableArtifact` (GFM/JSON→table); image → `MediaLightbox`. `--chart-1…5` tokens added to `index.css`.
- `ArtifactActions` (copy/download) + `AIPublishMenu` (publish-out, below) in the panel header.

### 1c. Publish-out (manual; user is the actor — NOT gated) — `features/ai/publish/`
- `AIPublishMenu.tsx` ("…" on assistant messages + artifacts; hidden for read-only logins): Publish as note (`buildRootNote`), Publish as article (`ArticleComposeModal` → **new `buildArticle` kind:30023** in `eventBuilder.ts`), Post to space (`SpacePickerModal`+`buildChatMessage`/kind:1 + host-relay connect), Send as DM (`RecipientPickerModal`+`sendDM`). Modeled on `music/TrackActionPanel`.

### 1d. Agentic tool-use (gated) — `features/ai/tools/` + `gate/`
- `tools/{types,registry,readTools,writeTools,validate}.ts`. Tools → OpenAI/Anthropic schemas (already plumbed in the providers); **write tools omitted entirely when `signerType===null`** + re-checked at run time.
- READ (auto-run, results framed UNTRUSTED): `get_profile`, `read_thread`, `read_space_feed`, `list_my_spaces`, `search_notes` — reuse the `aiContext` builders, drop muted.
- WRITE (gated): `publish_note`/`reply_to`/`send_dm`/`post_to_space`/`publish_article`. `run()` builds NOTHING signed — it registers a `PendingWrite` (internal nanoid `id`; the provider `toolCallId` is kept as a field, never as identity — id-reusing OpenAI-compat servers must not collide/overwrite drafts, audit #48; the reducer also refuses id reuse) and returns an "awaiting approval" tool result using **neutral identifiers** ("a DM to the resolved recipient", "a message to the selected space") — space names / contact display names are attacker-authorable and stay on the approval card only (audit #93). Pending writes persist per-account in the `aiPendingWrites` IDB store (24h TTL → `expired`, unsignable; `publishing` interrupted by reload → `error`) — audit #98. `gate/PendingWriteCard.tsx` shows the exact draft + target (Intent Preview) with **Approve / Edit / Cancel**; `gate/approveWrite.ts` resolves relays/recipients app-side and signs via `signAndPublish`/`sendDM` ONLY on Approve (no optimistic publish; "Waiting for signer…" pending state for NIP-46; reports relay count). Max 3 open pending per conversation.
- **Tool loop** lives in `streamRunner` (depth ≤5): stream → run tools → re-feed results (providers now serialize assistant `tool_calls` + `tool`/`tool_result` messages — OpenAI `tool_calls`, Anthropic `tool_use`/`tool_result` blocks merged) → continue. `enableTools` pref (default on; toggle in `AISettingsTab` for local models that 400 on tools). Bubble shows a "Used …" tool indicator.
- **Security (research: agentic-safety brief — OWASP LLM01/06, lethal trifecta, EchoLeak):** agent NEVER touches the signer; reads auto-run but every write is a human-gated proposal; untrusted content is data-framed; a turn can read untrusted content but cannot auto-act (the gate is the backstop); relays/recipients are resolved app-side, never model-chosen; recipients must be an npub/hex or an existing contact. `nostr-security` skill consulted.

### Web search (BYO key) — `features/ai/tools/webSearch.ts`
- A `web_search` READ tool (Tavily / Brave / Exa). Key in **keychain + in-memory cache** (`webSearchKeySecret`, loaded in `AIProvider`, never Redux); pref `webSearchEnabled` + `webSearchProvider` (non-secret). Settings: a "Web search" section (toggle + provider select + key input). Advertised only when enabled **and** a key is loaded (`getActiveTools` → `isWebSearchConfigured`). Results are framed UNTRUSTED (web = injection vector) and flow through the same gate — the agent can read the web but can't auto-act on it. **This is the template for adding more tools (MCP/RAG): just more `ToolDef`s.**

### Safe inline-HTML rendering — `markdown/remarkInlineTags.ts`
- Markdown has no underline syntax, so models emit `<u>` (and `<mark>`/`<sub>`/`<sup>`/`<b>`/`<i>`/`<del>`/`<br>`). We render a STRICT allowlist of bare, attribute-free inline tags by pairing CommonMark's `html` open/close nodes into mdast nodes carrying `data.hName` — **no `rehype-raw`** (nostr-security skill). Any attributes, other tags, scripts, or URLs never match and stay literal escaped text.

### Streaming/UX wins shipped alongside (research: streaming-md brief + UX critique)
- Scroll-to-bottom button + `aria-live="polite"` status region in `AIMessageList`; footer actions visible (opacity-60, not hidden); `AIPublishMenu` in the assistant footer.
- **Last-used model is cached** (`AIModelPicker` always writes the persisted default → new chats / "Ask AI" / restarts reuse it); model-groups selector memoized (no rebuild per streaming delta); list selectors return a shared frozen empty array.
- **Token stats labeled** (`↑ N in` / `↓ N out` / tok/s, each with a tooltip).
- **Personalization** (`AISettingsTab`): global system-prompt + temperature (per-conversation `systemPrompt` overrides), wired into every turn.
- **Streaming markdown** (`AIMarkdown`): incremental tail re-lex (O(n²)→~O(n)), `repairMarkdown` applied to the last block only, and a CSS streaming caret (`.ai-streaming`).

### Contracts added in Phase 1 (don't break)
- **Agent never signs.** Tools only produce unsigned drafts; `gate/approveWrite.ts` is the ONLY place a tool-originated event is signed, and only on human Approve.
- **Artifacts are derived, idempotent:** id=`${messageId}#${index}`; re-extraction (completion + hydration) upserts. Don't give artifacts random ids or a separate IDB store without rethinking this.
- **Tool round-trip:** an assistant message with `toolCalls` MUST be followed by a `tool` result per call in `buildEngineMessages` (OpenAI rejects orphan tool messages). `executeToolCalls` always produces a result for every call.
- **Untrusted framing:** all injected context + all read-tool output go through `frameUntrustedBlock`.

---

## ⏭ REMAINING PHASES

### Phase 2 — Managed local engine = `llama-server` (native `src-tauri/src/llm.rs`)
Clone `cloudflared.rs` (download/verify/chmod, add progress `tauri::ipc::Channel`) + `tunnel.rs` (spawn/stdout-parse) + `relay.rs` `base_dir`. Commands: `llm_engine_ensure`, `llm_server_start/stop/status`, `llm_model_download` (HF GGUF, `.part`+atomic-rename), `llm_models_list/_delete`, `llm_scan_local_models` (reuse `~/.lmstudio`/Ollama/HF-cache GGUFs), `llm_hardware_info` (sysinfo + wgpu + nvidia-smi/rocm-smi). Register in `lib.rs`. Deps: `sysinfo`, `futures-util`, opt `wgpu`. Notarization: downloads land in `app_local_data_dir` (bundle untouched); the downloaded binary must itself be signed (run cloudflared's `codesign --verify`).

### Phase 3 — Image + audio engines
Remote (DALL·E/Stability/fal/Replicate/ElevenLabs/MusicGen) = pure TS HTTP via `engineFetch`. Local (ComfyUI :8188 / A1111 :7860) = detect + HTTP (localhost cap already added); optional download/spawn reuses Phase-2 commands. Implement `imageProvider`/`audioProvider` (same `LLMProvider`, yield `image`/`audio` chunks — already in `ChatChunk`). Pipe into artifacts + publish-out (upload via `lib/api/blossom.ts`; consider kind:20).

### Phase 4 — In-process mistral.rs
`llm_infer_stream(prompt, model, Channel<TokenChunk>)` behind cargo `mistral` feature (default off). Evaluate mac-Metal-default-on hedge. `inProcessRust.ts` provider slot already reserved.

---

## ✅ Hardening pass (post-Phase-1 audit — 28 verified findings)
A `Workflow` audit (`ai-harden-audit`: correctness/security/perf/UX reviewers + adversarial verify) drove these. **Shipped:**
- **Perf:** `selectProviderConfigs` memoized via `createSelector` (was a fresh array each call → re-rendered the always-mounted model picker every streaming delta); picker's fallback scan made lazy; list selectors share a frozen empty array.
- **Security:** **EchoLeak fixed** — AI markdown + artifact images are **click-to-load** (`markdown/SafeImage.tsx`), never auto-fetched (a remote `<img>` was a zero-click exfil channel). `list_my_spaces` output now framed untrusted (+ name clamp). The gate shows the **recipient npub** (not just an attacker-influenceable display name). `approvePendingWrite` reads **live status** before signing (double-publish guard). **Per-turn caps**: ≤8 tool calls/turn + ≤5 web searches/user-message.
- **Correctness/robustness:** user **Stop** finalizes the partial as complete (no red "Cancelled." error; empty → bubble removed); **MAX_TOOL_DEPTH** forces a final tool-free answer + a hard loop bound (no silent tool-only bubble, no runaway); providers **synthesize missing tool-call ids** + drop empty-name fragments (id-less local models); explicit `isError` on `ToolRunResult` (no more `"Error"` string-sniffing); `removeMessage`/regenerate **prune orphaned artifacts**; SSE flushes a final event-framed payload with no trailing newline; Anthropic `max_tokens` 4096→8192; dead `evictConversationMessages` wired (evict prev conversation on switch).
- **UX/design-system:** **sidebar** rebuilt (search filter, relative timestamps, rename [`renameConversationEverywhere` now live], delete via `PopoverMenu`); **model picker → `PopoverMenu`** (+ `aria-haspopup`/`listbox`/`option`, Escape/click-outside/flip); **composer** Escape-to-stop, inline model badge, keyboard hint, suggested-prompt chips when empty; settings default-model controls relabeled ("Model when used" / "Set as default provider"); shared **`components/ui/Toggle`** extracted; `ArticleComposeModal` uses `Button`; field chrome unified; per-message **timestamps**; aria "Generating…" + `ThinkingDots` sr-only.

## Polish backlog (any time)
- **`NoteThreadPage` overflow** "Ask AI" (last surface — minor; the note already gets it via the action bar).
- **Tool capability probe (research: local-toolcalling brief):** `enableTools` still just sends `tools`; a strict local engine may 400 or drop tool calls. Add a per-model probe → degrade to JSON-in-text or disable; normalize `finish_reason` quirks.
- **More tools (registry is the template — `web_search` shipped):** MCP adapter (HTTP/SSE → `ToolDef`s); provider-native Anthropic `web_search`/OpenAI `file_search` toggle. _→ new thread._
- **RAG over the user's own posts (TODO):** opt-in embeddings + vector index over notes/DMs/spaces + a `search_knowledge` tool; `search_notes` is today's keyword stub. _→ new thread._
- **Deferred from the audit:** message-list **virtualization** (large convos — DOM size, not re-renders); model-picker **arrow-key** nav (Tab+Escape done); **avatar grouping** of consecutive turns (timestamps done); artifact **versioning** (single-version per `${messageId}#${i}`). (`pendingWrites` persist/prune shipped in the 2026-06 audit remediation, Phase 5.)
- **Smaller:** edit-and-resend a user message; math (`remark-math`+`rehype-katex`); mermaid renderer; model search box; conditional `stream_options.include_usage` for strict local servers; adopt the shared `Toggle` in the other settings tabs.

## Test coverage (Phase 1)
- **Logic:** `parseArtifacts` (fenced/directive/large-vs-small/unterminated/nested/MIME-map incl. svg→code), `chartSpec` (coerce/clamp/reject/pie/scatter/color-rejection), `tools/validate`, `aiContext` (framing + **delimiter-injection defense**, builders, muted filtering, preview/image marker), `tools` registry (signer gating, error paths, write→PendingWrite, 3-cap, no-DM-to-strangers), `webSearch` (per-provider request building, parse/cap, run success/error, config gating), `buildArticle`, `buildEngineMessages` (**tool round-trip serialization**), providers (`openaiCompat`/`anthropic` SSE→ChatChunk + tool reassembly + request-body serialization, non-ok→error), `approveWrite` (kind→builder→sign mapping, edits, failure path), `AIMarkdown` (incremental-lex equivalence + repair + **inline-HTML allowlist incl. `<script>`/attribute rejection**).
- **Components (RTL):** `AIContextChip`, `PendingWriteCard` (Intent Preview + Approve/Edit/Cancel), `SafeImage` (click-to-load).
- **Integration:** `streamRunnerLoop` — the tool loop end-to-end (read tool → re-feed → final answer; single-turn; depth cap forces a final answer + bounds the loop) against a scripted mock provider + the real store. Plus SSE final-flush, web-search budget, `list_my_spaces` framing.
- **Remaining gaps:** broader render tests for the chat view (message list / streaming bubble); the abort path is covered in logic but not via a full mid-stream-abort integration test.

## Verify
- `pnpm --filter @thewired/client typecheck` (clean)
- `pnpm exec vitest run` (in `client/`) — **754 pass**; AI-specific: `pnpm exec vitest run src/features/ai`
- `pnpm exec vite build` (in `client/`) — recharts is code-split into a lazy `ChartArtifact` chunk
- Manual (Phase 1): enable AI → right-click a note/thread/profile/DM → "Ask AI" pre-fills context → reply streams; a ` ```chart ` block opens the Artifacts panel; the assistant "…" publishes a note/article/space-msg/DM; "post a note saying hi" → a PendingWrite card → Approve publishes (reports relays), Cancel doesn't; read-only login shows no write tools / no publish menu.

## Phase 1 recon artifacts (this session)
A background `Workflow` (`ai-phase1-recon`) produced: surface maps (used to wire 1a/1c), and 5 research briefs — **artifacts-canvas** (in-band directive + fenced fallback; AI-SDK id-reconciliation; chip-not-badge), **recharts-safety** (lazy-load; bounded palette-index JSON spec), **agentic-safety** (lethal trifecta; human gate is the backstop; never ingest-and-act; EchoLeak), **streaming-md** (block-memo validated; O(n²) + caret + a11y gaps), **local-toolcalling** (engine/model support matrix + degradation tiers) — plus a UX critique. The actionable remainders are folded into the Polish backlog above.
