# Implementation Plan — Albert (formerly Cue)

Goal: implement the user's requested feature sequence with independent testing for each stage.

Assumptions
- Two-speaker meeting model ("You" = microphone / user, "Them" = speaker/system audio).
- Existing project entry points: [main.js](main.js), [src/prompts.js](src/prompts.js), [src/stt.js](src/stt.js), [src/store.js](src/store.js), [src/screen.js](src/screen.js).
- Settings are persisted in `cue-data.json` via [src/store.js](src/store.js).

Overview of stages (high level)
1. Chat history (persist prompts & AI responses)
2. Meeting notes UI + periodic summarizer (1-minute cadence, two-speaker assumptions)
3. LeetCode multi-screenshot capture (button + shortcut to add captures to the same prompt)
4. Model autodetection and recommended model
5. Token estimation and a cost bar

For each stage: design, files to change, implementation steps, tests, rollout notes.

---

Stage 1 — Chat history
**Goal:** Persist every user prompt we send to the LLM and the LLM's response. Keep raw prompt text (what we send) and the AI reply; later we can add summaries.

Design
- Data model: `history` array persisted in user data (new `history.json` or inside `cue-data.json` under `sessions.history`). Each entry:
  - id (ISO timestamp)
  - mode (assist/ask/leetcode/etc)
  - prompt (string) — exact built prompt sent to provider
  - image (optional) — data URL or filename for screenshot(s)
  - response (string) — full LLM output
  - provider, model, duration_ms, tokenEstimate (optional)
- Where to persist: add a small helper in `src/store.js` (or `src/history.js`) to append/read history. Keep file size bounded (e.g., roll new session files or limit to last N entries).

Files to change
- [main.js](main.js) — intercept `runFeature()` LLM call to capture `built` prompt, `imageDataUrl`, and capture stream output into `response` string; on `done` save history via store API.
- [src/store.js](src/store.js) — add methods: `appendHistory(entry)`, `getHistory()`, `clearHistory()` (or create `src/history.js` if preferred).
- Renderer UI: `renderer/renderer.js` & `renderer/index.html` — add small History panel accessible from Settings or main UI.

Implementation steps
1. Add `appendHistory()` and `getHistory()` to `src/store.js` (persist to `cue-data.json.history` or new `history.json` in `userData`).
2. In `main.js.runFeature()`: collect `built`, `imageDataUrl`, start `response = ''`, then in `llm.stream({ onToken })` append tokens to `response`. On success, `store.appendHistory({ ... })` with metadata.
3. Add IPC endpoints: `ipcMain.handle('history:get')` and `ipcMain.handle('history:clear')`.
4. Renderer: build a History view listing entries (timestamp, mode, short preview), click to expand full prompt + response, and an export button (JSON/Markdown).

Testing plan (Stage 1)
- Unit: call `store.appendHistory({mode:'ask', prompt:'x', response:'y'})` and verify `getHistory()` returns the entry and file is written.
- Integration: run an `ask` feature in the UI and confirm the corresponding history entry appears and includes full built prompt and LLM response.
- Edge cases: large responses (ensure filesystem write handles large strings), binary images (store filename instead of inline dataURL if >1MB).

Rollout notes
- Keep history opt-in (add a setting `storeHistory: true` default true or ask consent). Provide a clear delete/clear action.

Estimated complexity: low → moderate (mostly plumbing + UI).

---

Stage 2 — Meeting notes UI & periodic summarizer
**Goal:** Create a `Meeting Notes` panel that updates every N seconds (configurable; default 60s). The panel shows a timeline of short bullets. The summarizer will use the most recent transcript window + previous notes as context and return concise incremental updates.

Design
- Data model: `meetingNotes` live in memory for the session and persisted optionally to history/session file when meeting ends or on user save.
- Summarization strategy:
  - On interval (default 60s) or after M new turns, call LLM with prompt:
    - system: `recap` style instruction to produce short bullets + action items
    - context: last T seconds / last N turns (use `formatTranscript` but convert to time window if implemented)
    - previous notes: pass previous bullets so LLM can delta-update (respond only with new or updated bullets and markers)
  - Merge delta into `meetingNotes` and only update UI when there is a net change.
- Two-speaker assumption: use `transcript` channel names (`you`/`them`) already in `main.js`.

Files to change
- [main.js](main.js) — implement a `meetingNotes` structure, timer to call summarizer, IPC endpoints to show/clear notes, and persistent save on demand.
- [src/prompts.js](src/prompts.js) — add a small `meetingSummarize` prompt template (system & build function) that accepts `prevNotes` and `recentTranscript`.
- [renderer/*] — add `Meeting Notes` UI panel (list, save/export button, frequency setting).

Implementation steps
1. Add a new `MODES.meeting_summary` or a helper prompt builder in `src/prompts.js` for incremental summarization.
2. In `main.js`, add `meetingNotes = []` and `startMeetingSummarizer(intervalMs)` that runs only when capturing is active (configurable setting). Each run:
   - Build prompt with last N turns and `previousNotes`.
   - Call `llm.stream()` (or a non-streaming generate) to get short bullets.
   - Compute delta and update `meetingNotes` and `transmit` minimal update to renderer: `send('meeting:notes:update', meetingNotes)`.
3. Renderer displays notes and provides `Save`, `Clear`, `Export` controls.

Testing plan (Stage 2)
- Unit: test `src/prompts.meetingSummarize.build()` produces the expected prompt given sample `transcript` and `prevNotes`.
- Integration: simulate audio input (or replay known transcript) and verify the summarizer runs every minute and `meetingNotes` grows incrementally; check that when nothing new is said, notes do not spam updates.
- Load test: run summarizer with dense transcripts to ensure rate-limiting & backoff (avoid overlapping summarizer runs).

Cost & mitigation
- This adds periodic LLM calls — make frequency configurable and allow `off` to reduce usage. Implement simple rate-limiting if LLM returns 429.

Estimated complexity: moderate.

---

Stage 3 — LeetCode multi-screenshot capture
**Goal:** Allow user to take multiple screenshots for a single `leetcode` run and attach them all into the same LLM prompt.

Design
- UI: a small modal when `leetcode` is triggered or a persistent `Add screenshot` button in the composer. Provide `Capture more (Cmd/Ctrl+Shift+H)` and `Done` actions.
- Storage: keep an array `imageDataUrls` per run; optionally persist to disk if >n images.
- LLM call: when building the `leetcode` prompt, include all imageDataUrls (LLM wrapper already supports `imageDataUrl` field — extend to accept array or send first and include OCR of the rest inline).

Files to change
- [main.js](main.js) — modify `runFeature()` to allow collection of multiple screenshots when `def.needsScreen` is true. Add IPC handlers like `ipcMain.on('screenshot:add')`.
- [src/screen.js](src/screen.js) — unchanged; it returns one screenshot per call, which is fine.
- `renderer/*` — add UI (floating small modal) to let user capture more screenshots and then trigger `runFeature('leetcode')` with collected images.

Implementation steps
1. Add UI control: when user fires `leetcode`, open a temporary modal in renderer showing the captured screenshot with `+ Add more` and `Done` buttons.
2. Each `Add more` triggers `ipcRenderer.invoke('capture:screenshot')` which calls `captureScreenshot()` in main and returns a dataURL; append it to images array.
3. On `Done`, call `ipcRenderer.send('ask', { mode: 'leetcode', text: '' , images: [ ... ] })` (or modify `runFeature` signature to accept images). In main, pass image array to LLM streaming call.
4. Update `history` to store all images for that run.

Testing plan (Stage 3)
- Manual: trigger `Cmd+H`, capture one screenshot, then `Add more`, ensure next screenshot appears and all are sent to LLM.
- Edge cases: very large images; if combined payload exceeds provider limits, fall back to OCRing extra images and include extracted text only.

Estimated complexity: low → moderate (UI + IPC plumbing). OCR fallback increases complexity.

---

Stage 4 — Model autodetection
**Goal:** Probe a provider for supported models or probe recommended models for the given API key, then suggest a recommended model in Settings.

Design
- When user updates API key in Settings, run a light-weight detection routine:
  - Preferred: call provider model-list endpoints (OpenAI `models.list()`, Google GenAI model list API, Anthropic models listing). Parse response for available models and choose the highest-quality available.
  - Fallback: attempt a tiny generation (very small prompt) against candidate models in a prioritized list until one succeeds.
- Cache the detection result in settings with `detectedModels` and `recommendedModel` and timestamp.

Files to change
- [main.js](main.js) — in `ipcMain.handle('settings:set')` trigger a background `detectModels(settings)` task and `send('settings:detected', result)` when done.
- Add `src/modelDetect.js` implementing provider-specific detection logic.
- UI: Settings panel in renderer to surface `recommended model` and a `Use recommended` button.

Implementation steps
1. Implement `src/modelDetect.js` with provider adapters.
2. Wire detection to run after `settings:set` completes; ensure detection is debounced and limited in retries.
3. Store results via `store.setSettings({ modelsDetected: {...} })`.

Testing plan (Stage 4)
- Unit: mock provider clients (or run with known good keys) and verify detection returns expected models.
- Integration: paste an API key and verify the UI shows `recommendedModel`, and `runFeature()` honors the chosen model.

Caveats
- Probing may consume quota; detectModels must be conservative, and allow user to opt-out.

Estimated complexity: moderate.

---

Stage 5 — Token estimation and cost bar
**Goal:** Provide a live estimate of token usage per session and a UI bar showing approximate remaining budget (user-configured or provider-reported).

Design
- Estimator: simple heuristic (chars / 4) as a starting point. For OpenAI, integrate a tokenizer (e.g., `tiktoken` or a JS port) for better accuracy.
- Hook: wrap the LLM calls to record estimated input tokens (built prompt length), and estimate output tokens as they stream; increment `usage[provider]` and persist periodically.
- UI: show a compact usage badge in the main UI and a full bar in Settings with `Reset` and `Set monthly limit`.

Files to change
- [src/llm.js] (or wherever LLM wrapper lives) — record token estimates per request and expose usage via IPC.
- [src/store.js] — add `usage` storage and helpers.
- `renderer/*` — add the UI bar and settings.

Implementation steps
1. Implement a small `estimateTokens(text)` helper in `src/utils.js`.
2. In `llm.stream()` call sites, run `estimateTokens(built)` and onToken increment estimated output tokens.
3. Persist `usage` to `cue-data.json` and show in UI.

Testing plan (Stage 5)
- Compare estimated tokens for known strings against a tokenizer in unit tests.
- Simulate a session with multiple LLM calls and verify the UI bar increments and resets correctly.

Estimated complexity: low → moderate depending on tokenizer integration.

---

Cross-stage concerns
- Storage footprint: keep history bounded; consider rotating files per-day or per-session.
- Privacy controls: add toggles to disable history, meeting notes persistence, or remote sync (if added later).
- Rate-limiting: for periodic tasks (meeting summarizer and model-detect), implement exponential backoff on 429/503.
- UX: avoid noisy updates; only patch meeting notes when there is a meaningful change.

Testing matrix (independent test for each stage)
- Stage 1 tests: append/get/clear history; UI shows full prompt + response; export JSON.
- Stage 2 tests: summarizer runs on timer; merging logic produces incremental updates; configurable interval respected.
- Stage 3 tests: multi-screenshot modal captures multiple images; all images arrive in `main.runFeature` and are recorded in history; fallback for large payloads.
- Stage 4 tests: detection runs only when keys change; detection result cached; `Use recommended` picks recommended model.
- Stage 5 tests: estimator returns repeatable estimates; usage persisted and UI bar updates.

Milestones & timeline (rough)
- Day 1: Stage 1 (Chat history) → implement store methods, main plumbing, basic UI.
- Day 2: Stage 3 (LeetCode multi-screenshot) → UI modal + IPC + history attachment.
- Day 3: Stage 2 (Meeting summarizer) → prompt template, timer, UI notes.
- Day 4: Stage 4 (Model autodetect) → detection module + Settings UI.
- Day 5: Stage 5 (Token estimation) → estimator + usage UI + improvements.

Deliverables (what I'll add first)
- `src/store.js` additions for history/usage persistence or `src/history.js` helper file
- `main.js` wiring to capture prompts & responses
- `renderer` UI panels for History and Meeting Notes
- `src/prompts.js` additions for meeting summarizer
- `src/modelDetect.js` (probe logic)
- `docs/IMPLEMENTATION_PLAN.md` (this document)

Next immediate step (with your approval)
- Implement Stage 1 (Chat history): I'll add persistence methods, wire `runFeature()` to save prompts + responses, add IPC endpoints, and create a minimal History panel in the renderer. I will run unit checks (write/read history file) and a quick manual integration to verify.

---

Appendix: Quick-code pointers
- Where transcripts are appended: [main.js](main.js#L38-L56) (see `transcript.push(turn)`).
- Where feature prompts are built and LLM invoked: [main.js](main.js#L103-L146) (`built = def.build({ transcript, userText })`).
- Where screen capture is taken: [main.js](main.js#L111-L118) and [src/screen.js](src/screen.js).
- STT chain and providers: [src/stt.js](src/stt.js).
- Settings store: [src/store.js](src/store.js).


*Plan written and triple-checked against current repository files.*
