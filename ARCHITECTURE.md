# ProEtsy — Modular Architecture

This document defines the modular version of the original build plan. It supersedes nothing — the original plan doc stays as-is — but this is the spec to build against: React frontend, Node.js backend, runs fully locally, deployable later.

**LLM provider: Gemini (free tier, multiple keys) is primary and native.** Claude API is an optional fallback behind the same interface, not required to run the app.

**Status:** all modules below are built and tested (unit, idempotency, and route-level integration tests exist for every module unless noted). This doc describes the current architecture, not a build log — see git history / PR descriptions for how each piece was implemented.

## Guiding principles

- **Modular**: every pipeline stage is a self-contained module with a defined input/output contract. Any module can be swapped, disabled, or replaced without touching the others.
- **Local-first**: the whole app runs end-to-end on a dev machine (local DB, local file storage, no cloud deploy required).
- **Steps are optional**: each pipeline run is driven by a config (with UI override) that says which modules run, in what order, and which are skipped.
- **No auto-generation where the user already has assets**: mockups use the user's own templates, not Canva/Pillow generation. Trend data is manually selected, not scraped.
- **Human-in-the-loop, always**: nothing auto-publishes and nothing auto-discards. The user reviews and confirms every generated artifact.

---

## Pipeline overview

```
[Module 7: Taste Filter]          (optional, pre-pipeline — ranks raw Midjourney batches)
      ↓
[Upload Artwork]
      ↓
[Module 1: Image Analyzer]        (optional)
      ↓
[Module 2: Listing Generator]     (core)
      ↓
[Module 3: Mockup Composer]       (optional, uses user's own mockup files)
      ↓
[Review / Edit] (human-in-the-loop, always available)
      ↓
[Done — publish to Etsy manually]
```

Etsy publishing is manual by design — no auto-uploader module. The app's job ends at producing an approved, ready-to-copy listing (and mockups); the user pastes it into Etsy themselves. Every arrow above the final step is a toggle point — a run can go straight from upload → listing generator → manual copy-paste, skipping mockups entirely. Module 7 is a separate, earlier gate for raw Midjourney output: it never touches the main listing pipeline directly; its only output is a ranked/labeled set of images, some of which get dragged into the main pipeline as "Upload Artwork."

---

## Modules

### Module 1 — Image Analyzer (optional)
Analyzes uploaded artwork (`backend/lib/image-analyzer/`) and persists a structured description onto `artworks.image_analysis` (keyed by artwork, not job — a re-run overwrites, matching "one current value" semantics). Optional module: a failure here pauses the job and asks for manual notes (`PATCH /api/jobs/:id/manual-notes`) instead of failing it — Module 2 can still proceed.

**Input:** artwork file
**Output:** structured description (subject, style, palette, mood) used by Module 2 and for tag matching
**Tech:** Gemini API (vision, multimodal) via the LLM provider layer
**Can be skipped if:** user wants to hand-write listing angle/keywords instead
**Dashboard:** `frontend/src/JobArtworkAnalysisReview.jsx` — view/re-run analysis, manual-notes fallback.

### Module 2 — Listing Generator (core, not skippable)
Generates 3 listing variations (`backend/lib/listing-generator/`), enforces shop conventions server-side on every generate *and* every manual edit (so a manual edit can't slip a forbidden word or oversized tag past the rules).

**Input:** image analysis (or manual notes) + selected trend (manual) + tag library
**Output:** 3 listing variations (fine art/decor, aesthetic/trend, gift angle), each with title, description, tags
**Default shop conventions (dashboard-editable, see `getShopConventions`/`setShopConventions` in `config/index.js`):**
- Title separator: `|`
- Max title length: 140 characters
- Tags per listing: 13 (+5 alternatives), max tag length 20 characters
- No frames mentioned in titles
- No AI disclosure in descriptions
- No delivery details in descriptions
- Sizes referenced come from the shared **product-sizes config** (see Module 3) — only sizes with a matching mockup template are offered/mentioned.
**Tag selection:** via the **tags provider layer** (see below) — currently the user's pre-made tag list, matched to image analysis output.
**Tech:** Gemini API via the LLM provider layer
**Dashboard:** `frontend/src/JobListingReview.jsx` — editable card per variation, Save (re-validates server-side), Copy-for-Etsy, inline warnings.

### Module 3 — Mockup Composer (optional)
Composites artwork into the user's own mockup templates. No Canvas/Pillow/Canva API — a single `mockup-generator.js`.

**Input:** artwork file + product type (e.g. "8x10 print", "square canvas")
**Output:** composited mockup image(s), in the shop's defined display order
**Aspect-ratio mismatch handling** (never a blind center-crop, never letterbox/pad):
- **Small mismatch → content-aware smart crop.** `smartcrop.js` (pure JS, no native deps) detects the subject/focal region and crops around it.
- **Large mismatch → AI outpainting.** Sent to Gemini's image model (`gemini-3.1-flash-image`, pinned) to generatively extend the canvas to the target aspect ratio rather than crop away content or pad with blank space.
- **Review step:** when both variants exist, the dashboard shows smart-crop and AI-extended side by side and the user picks (`JobMockupReview.jsx`, `PATCH /api/jobs/:id/mockups/:mockupId/variant`). Smart-crop is the safe fallback if outpainting fails or looks wrong — a bad AI result never blocks the pipeline (flagged via `warnings`, not hidden).
- Both variants are persisted independently (`file_path` = currently selected, `smart_crop_path`/`ai_extended_path` = each variant's own path), so switching back and forth never loses either one.

**Template formats: PNG (flat) and PSD (layered, smart-object-style).** Most purchased Etsy mockup packs ship as layered `.psd` files built around a Photoshop smart object, so the composer reads PSD layer structure directly rather than requiring a pre-flattened PNG:
- Template kind is inferred from file extension — no separate config flag.
- **`ag-psd`** (pure JS, no native deps) reads the PSD's layer tree/bounds/blend info. Its Canvas2D requirement is satisfied by a pure-JS shim (`backend/lib/psd-canvas.js`, backed by `pureimage`) instead of `node-canvas`, which has native Cairo bindings that would break the project's zero-native-deps/Termux/Electron constraint.
- **Placement is layer-based, not whole-canvas.** `product-sizes.json` gains an optional `placement_layer` field naming the PSD layer whose bounds mark where the artwork goes (defaults to `"artwork"`). The artwork is smart-cropped/resized to that layer's bounds, then every visible layer is rendered in stacking order onto the full-document canvas, substituting the artwork bitmap for the placement layer's pixel data. Hidden flags and per-layer opacity are respected; blend modes beyond default source-over are not re-implemented.
- **Known limitation:** `ag-psd` doesn't re-evaluate Photoshop smart-object warp/perspective transforms or most layer effects (drop shadows, overlays). A smart object warped to sit at an angle inside a photographed frame will place the artwork as an unwarped, axis-aligned rectangle — spot-check every new PSD template after its first run. (A follow-on option — reading the warp-transform matrix and applying a matching affine transform — is real additional work, not done, worth revisiting only if warped templates turn out to be common.)
- Flat PNG/JPEG templates are unaffected — "template canvas = full output, transparent window" convention, unchanged.

**Product-sizes config** — one row per size in the `product_sizes` DB table (`size_key`, `dimensions`, `dpi`, `orientation`, `mockup_template_path`, `placement_layer`), dashboard-editable via `MockupTemplates.jsx` / `POST /api/mockup-templates` / `DELETE /api/mockup-templates/:sizeKey`. Conceptually the same shape a `product-sizes.json` file would have held:
```json
{
  "8x10-portrait": { "dimensions": "8x10", "dpi": 300, "orientation": "portrait", "mockup_template": "templates/8x10-frame.png" },
  "square-canvas":  { "dimensions": "12x12", "dpi": 300, "orientation": "square",   "mockup_template": "templates/square.png" },
  "framed-psd":     { "dimensions": "11x14", "dpi": 300, "orientation": "portrait", "mockup_template": "templates/framed-wall.psd", "placement_layer": "artwork" }
}
```
This is the single source of truth for both Module 2 (which sizes are sellable/mentionable) and Module 3 (which template to composite into). New product types are added through the dashboard (or directly in the DB), not by editing a config file.

**Dashboard:** `MockupTemplates.jsx` — folder scan/picker, per-row Save/Remove, full CRUD over `product_sizes`.

### Module 4 — Trend/Prompt Helper (optional, manual-trend version)
**What changed from the original plan:** no live Etsy trend-pulling API call — trends come from the **trends provider layer** (see below), backed by a manually maintained/dashboard-entered list.

**Input:** selected trend + desired orientation
**Output:** ready-to-paste Midjourney prompts using shop conventions (`--v 7`, `--style raw`, aspect ratio per orientation, `--s 50–150`)
**Tech:** Gemini API via the LLM provider layer, no Etsy API dependency. This module only *writes* Midjourney-formatted prompt text — it never calls a Midjourney API.
**Deliberately not job-scoped** — isolated from the main pipeline (see Partial Failure Handling): a generation run is keyed only by an optional `trend_id` + target `orientation`. Each call inserts a new batch of `prompts` rows (a browsable history), unlike listings/mockups' one-row-per-key upsert.
**Optional style hints:** pulls up to 5 terms from Module 7's `prompt_terms` where kept-count beats discarded-count, included as a non-overriding style hint — naturally a no-op until Module 7 has labeled data.
**Dashboard:** `frontend/src/PromptHelper.jsx` (not job-scoped) — orientation selector, trend picker + inline add-a-trend form, Generate, copy-to-clipboard, orientation-filtered history.

### Module 5 — Etsy Uploader
**Removed.** Etsy publishing is manual — the user copies the approved listing text and mockups into Etsy themselves. No Etsy API v3 integration, no OAuth, no bulk-publish. This removes the biggest external-account risk from the whole build (developer approval, bulk-publish bugs, API changes).

### Module 6 — Control Dashboard (core, not a pipeline step)
React frontend (`frontend/src/App.jsx`) that:
- Lets the user drag-and-drop artwork, single or bulk (`POST /api/artworks/upload`, multer) — a bulk drop creates one job per artwork, each proceeding independently (see Partial Failure Handling).
- Runs the pipeline server-side (`backend/lib/pipeline-runner.js`, `POST /api/jobs/:id/run` / `POST /api/jobs/run-batch`) — the run isn't tied to the browser tab staying open.
- Shows a **pipeline config panel**: per-run module toggles seeded from `pipeline.config.json`'s defaults; the required module (Module 2) is shown checked and disabled. Overrides apply to that run only.
- Job history log, grouped into collapsible "bulk batch" rows (jobs sharing a client-generated `batch_id`) with per-status badge breakdowns.
- Settings panel: tag-library paste/CSV import, default price/delivery text, trend-list management, shop conventions (dashboard-editable, see `getShopConventions`/`setShopConventions` in `config/index.js`), product-sizes/mockup templates (dashboard-editable — see Module 3's `MockupTemplates.jsx`).
- Review/edit any generated field before publishing (`JobListingReview.jsx`, `JobMockupReview.jsx`, `JobArtworkAnalysisReview.jsx`), each with Copy-for-Etsy / export.
- Persistent setup-status banner (`GET /api/setup-status`) — see First-Run Setup below.

### Module 7 — Taste Filter (Curation) (optional, pre-pipeline)
**What it does:** ranks a batch of raw Midjourney-generated candidates against a learned taste profile, so obvious "slop" gets flagged before it ever becomes a listing candidate.

**Input:** a batch of candidate images (generated manually in Midjourney, dragged into the dashboard, or auto-picked up from a watched folder)
**Output:** each candidate gets **two taste scores** — global and per-orientation — plus a suggested label (likely-keep / likely-discard / uncertain). By default every decision is a manual keep/discard confirmation, which is the training signal; an opt-in auto-compute mode (off by default — see below) can also apply a high-confidence decision automatically. Either way, nothing is ever auto-*deleted* — a discarded image's file always stays on disk.
**Tech:** local image embeddings via a **JS-only CLIP implementation** — `onnxruntime-web` (WASM) running the pre-converted `Xenova/clip-vit-base-patch32` ONNX model, called directly from the Node backend. No API key, no per-request cost, no network dependency, no second runtime to manage.

**Why WASM over native (`onnxruntime-node`):** no prebuilt binary to match against a specific libc/ABI — runs on Termux/Android (whose Bionic libc breaks `onnxruntime-node`'s prebuilt binaries) and sidesteps Electron's native-module rebuild step entirely. Trade-off: WASM CPU inference is slower than native, acceptable for single-user, one-batch-at-a-time use.

**How the "training" works:**
- Every keep/discard decision is stored as a labeled example (embedding + label + category) in `image_preferences`.
- **Two sets of centroids:** a global kept/discarded pair, and a per-category pair for each product category. A new candidate is scored against both via cosine similarity (kept minus discarded).
- Centroids recompute automatically after every labeled batch, plus a manual "Recompute now" button for after relabeling.
- **Cold start:** with only a handful of labels the system shows scores but doesn't filter confidently (`COLD_START_MIN_EXAMPLES = 30` combined examples, per category too).
- **Never auto-discards a file** — a "discard" decision (manual or auto-applied, see below) only records a preference row; the underlying image is never deleted.
- **Auto-compute (opt-in, off by default):** a Settings toggle (`taste_filter_auto_enabled` / `taste_filter_auto_threshold`) lets `POST /api/taste-filter/import` apply a decision automatically instead of waiting for a click, writing straight to `image_preferences` with `auto_labeled = 1`. Guardrails: only acts on a pair that's already cleared the same cold-start bar manual scoring requires; when a candidate has a category, the global and category-level decisions must independently agree, or it falls back to `null` (manual review) rather than one signal overriding the other. Auto-decided candidates still surface in the dashboard (a collapsible "Auto-sorted" section) and can be corrected with a normal Keep/Discard click — since `image_preferences` upserts on `image_path` (one row per image), a correction updates that row and clears `auto_labeled` back to `0`, rather than adding a second, contradictory row (see `docs/fixes/taste-filter-duplicate-labels.md` for the bug this closed).
- No "pending candidates" DB table by design: an imported batch that neither the user nor auto-compute has decided on yet lives only in the frontend's local state (manual import) or an in-process Map (watched-folder import) plus the files on disk — nothing is written to `image_preferences` for it until a decision, manual or auto, exists.

**Prompt-feedback link to Module 4 (optional, opt-in):** since Module 7's embeddings and Module 4's text prompts don't share a representation, the link is tracked via **which prompt terms tend to produce kept vs. discarded images** — each candidate is tagged with its originating prompt, and as labels accumulate, recurring prompt terms are tallied into `prompt_terms.kept_count`/`discarded_count`. Module 4 can optionally pull the top terms as a style hint (biases word choice, never overrides the user's trend selection). Secondary and opt-in — Module 4 works the same with it off.

**Auto-import via watched folder:** a `chokidar` watcher (`backend/lib/taste-filter/watcher.js`), toggled in the dashboard Settings panel (checkbox + folder path + optional category, off by default), detects new files dropped into a local folder (e.g. by Midjourney) and pulls them into the scoring queue automatically — pure local filesystem watching, no API call, no Midjourney ToS exposure.

**The closed loop:**
```
[Manual: paste Module 4's prompt into Midjourney, generate images]
              ↓
[Midjourney downloads land in a local folder]
              ↓
[Auto-import: watcher detects new files → pulls into Module 7 queue]
              ↓
[Module 7 scores each image against the CURRENT taste model]
              ↓
[Dashboard shows ranked batch: likely-keep / likely-discard / uncertain]
              ↓
[User reviews, confirms keep/discard]
              ↓
[Every confirmation → new labeled row → centroids recomputed]      ↑
              ↓                                          (model sharper for next batch)
[Kept images flow into "Upload Artwork" → main pipeline]
```
Labeling *is* the training — no separate training mode, and it never "finishes," since it keeps adapting as taste changes over time.

**Can be skipped if:** the user is hand-picking Midjourney output already and doesn't want the extra step.
**Dashboard:** `frontend/src/TasteFilter.jsx` (not job-scoped) — category/prompt-ID fields, drag-and-drop batch importer, ranked grid with score badges, Keep/Discard buttons (including on auto-sorted candidates, to correct them), a collapsible "Auto-sorted" section, Recompute-now.

---

## First-Run Setup

No separate installer or CLI wizard — the app detects its own setup state on launch and drives the dashboard accordingly.

**Detection:** on backend startup, check for (1) at least one Gemini key (dashboard-managed, DB-backed), (2) an initialized DB, (3) at least one configured row in the `product_sizes` table. If any are missing, the dashboard opens directly into a setup screen.

**Setup steps, ordered by what's actually required:**
- **Required to run at all:** at least one Gemini API key, saved to `.env` (never committed). DB schema auto-creates with no user action.
- **Required for Module 2 (core):** a starter tag list — paste a list or upload a CSV.
- **Required for Module 3 (likely wanted):** at least one product size + mockup template pair.
- **Skippable entirely:** trends list, additional Gemini keys, Claude fallback key.

**Persistent status, not just a one-time modal.** The same three checks live permanently in the dashboard's Settings panel as a ✅/⚠️ list, so anything skipped initially stays visible.

**Fail loud, not silent.** A module run without its required setup item points the error directly at the setup screen, not a generic API error.

---

## Local Backup

All data lives only on the local machine, so backups are local-to-local (no off-machine/cloud copy in scope):
- A `node-cron` job (nightly) snapshots the DB and zips it with `uploads/`, `templates/`, and config files into a timestamped archive in a local backup folder.
- **Retention:** last 7 daily + last 4 weekly archives; older ones deleted.
- **"Backup now" button** in Settings, for a manual trigger before a risky operation.

---

## Step control model

Two layers, both required:
1. **Config default** — `pipeline.config.json` defines, per shop/default setup, which modules are enabled and in what order.
2. **UI override** — the dashboard reads that config as the default toggle state for a new job; the user can flip any module on/off per run. Overrides apply to that run only unless explicitly saved as the new default.

```json
{
  "pipeline": [
    { "module": "image_analyzer", "enabled": true },
    { "module": "listing_generator", "enabled": true, "required": true },
    { "module": "mockup_composer", "enabled": true }
  ]
}
```
(No `etsy_uploader` entry — removed, publishing is manual.)

---

## Trends Provider Layer

```
lib/trends/
  index.js         -> exports getTrends(), chosen by config
  manual.js         -> reads dashboard-entered list / CSV import (v1 implementation)
  etsy-api.js       -> lightweight signal from Etsy's official Open API v3 (built)
  etsy-scraper.js   -> future: scraping a research tool's site directly (not built, rejected)
```

**Why manual + a sanctioned API signal, not scraping:** there's no public API for real trend/search-volume analytics — Etsy's own API doesn't expose it, and the popular third-party tools (eRank, Marmalead, Alura, EverBee, EtsyHunt, Sale Samurai) are closed dashboards built for humans, not developer APIs. Two ToS-clean pieces instead:
- **`etsy-api.js`** calls Etsy's official Open API v3 public listing-search endpoint (API key only) and computes a rough self-generated signal from recently-active, highly-favorited listings — not real trend data, just a lightweight proxy, but built on an endpoint Etsy explicitly wants developers to use.
- **CSV import in `manual.js`** — the user checks a research tool's free tier themselves and imports its export as CSV, rather than an automated scraper hitting the tool's interface (ToS/account-risk exposure). Dedup is scoped against terms that existed *before* the import call, so within-batch duplicates in a single CSV aren't under-inserted.

`etsy-scraper.js` stays unbuilt — same reasoning as the Midjourney-automation decision (see Future Consideration below): automating a site's interface risks account/IP-block. Revisit only if a tool ships a public API, or the user explicitly accepts that risk.

Flipping providers is a config change (`TRENDS_PROVIDER=etsy-api`), not a Module 4 rewrite.

---

## Tags Provider Layer

```
lib/tags/
  index.js          -> exports getTagCandidates(imageAnalysis), chosen by config
  user-list.js       -> matches against the user's pre-made tag list (v1 implementation)
  auto-suggest.js    -> future: suggests new tags from trend/market data (not built)
```

Tags are chosen from the user's pre-made tag library, matched against Module 1's image analysis output — never freely generated. Flipping to an auto-suggest source later is a config change.

---

## LLM Provider Layer

All three LLM-using modules (1, 2, 4) call a single shared interface instead of hitting a provider's SDK directly:

```
lib/llm/
  index.js       -> exports generateText(), generateVision(), generateImage(), chosen by config
  gemini.js      -> Gemini implementation (primary)
  claude.js      -> Claude implementation (optional fallback — currently a stub)
```

**Primary: Gemini, multiple free API keys.** Gemini's free tier is rate-limited per project/key. To stay within free limits at real usage volume, the provider layer pools multiple keys (`GEMINI_API_KEYS=key1,key2,...`) and rotates round-robin, retrying the next key on a 429. If every key is exhausted, the call fails clearly rather than hanging — no silent fallback to Claude unless explicitly enabled.

**Model cascade within a key.** A key is tried against a priority-ordered model list (`GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-pro` — Flash-tier first for headroom, Pro-tier last since its free-tier caps are tighter) before rotating to the next key: **for each key → for each model → attempt.** Rationale: a key's rate limit is typically per-model on Google's side, so exhausting a key's model options before rotating burns through the key pool more slowly. A call can pin a single model via `options.model` to skip the cascade (used when a call specifically needs Pro-tier reasoning).

**Proactive request spacing (before any 429 happens).** Bulk mode fires each artwork's job independently, so without throttling a bulk run could burst a dozen simultaneous requests — more likely to trip per-minute limits, and reads as scripted rather than a person clicking through a dashboard:
- At most one in-flight request per key at a time (a per-key queue).
- Minimum spacing between consecutive requests on the same key (`LLM_MIN_REQUEST_INTERVAL_MS`) plus randomized jitter (`LLM_REQUEST_JITTER_MS`), so requests land irregularly rather than on a fixed drumbeat.
- A global concurrency cap across the whole pool (`LLM_MAX_CONCURRENT_REQUESTS`), independent of key count.
- This queue sits in front of the cooldown cache below: cooldown check first (skip known-limited pairs, no call), then a queue slot, then the request.

**Rate-limit cooldown tracking.** A `(key, model)` pair that 429s is cached (in-process `Map`, keyed `${keyIndex}:${model}` → `{ limitedUntil }`) so future attempts skip it with no network call, until the cooldown window passes.
- **Not Redis** — deliberately an in-process `Map`, not a second service to install/manage, consistent with the project's no-second-runtime stance (same reasoning as Module 7's WASM choice).
- **Backed by SQLite for durability** (`llm_rate_limits` table) — an in-memory-only cache would forget daily-quota exhaustion on every restart. The `Map` is the hot-path read; SQLite is the source of truth, rehydrated on startup.
- Identified by key *index* (position in `GEMINI_API_KEYS`), never the raw key string.
- Cooldown duration: Gemini's `Retry-After`/`retryInfo.retryDelay` if present, else a configurable default (`LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS`).
- If every pair the cascade would try is already in cooldown, the call fails fast with a distinct "all keys/models in cooldown" message.

**Backoff means backing off, not retrying harder.** No sweep-level retry loop — if a sweep ends with every pair 429'ing or already cooling down, the call fails immediately (surfaced like any other module failure, retryable later by the user), rather than hammering the pool again within the same request. **Cooldown escalation** instead: a pair that 429s again before its previous cooldown elapsed gets a longer cooldown (doubling per consecutive hit, capped at `LLM_RATE_LIMIT_MAX_COOLDOWN_MS`), resetting on the next success.

**Structured output.** Calls needing reliable JSON (e.g. Module 2's 3-variation response) pass `{ json: true }`, setting Gemini's `generationConfig.responseMimeType = 'application/json'` — enforced by the API itself, not just prompt wording.

**Fallback: Claude.** Same interface, disabled by default; can be turned on in config if the Gemini cascade is exhausted, or for a specific module.

**Data note:** Gemini's free tier may use inputs/outputs to improve Google's models. Module 1 sends artwork images and Module 2 sends shop copy through it — factor that into whether free tier is acceptable, or a paid tier/different privacy setting is needed later.

---

## Partial Failure Handling

Every pipeline run is tracked as a **job**, and every module within a job has its own status — a failure in one module doesn't corrupt or block the rest of the job, and one job's failure doesn't block other jobs.

**Per-module status:** `pending` → `running` → `success` | `failed` | `skipped`

**Job-level rules:**
- **Module 1** failure → job pauses, asks for manual notes instead of auto-failing (optional module).
- **Module 2** failure → job stops, marked `failed` (core/required) — user can retry just that module.
- **Module 3** failure → the generated listing still surfaces for review (mockups are optional); the failure is flagged, not hidden.
- **Module 4** failure → fully isolated, never touches jobs in progress (not part of the main pipeline).

**Retry model:** each failed module gets a retry button, re-running only that module using the job's already-stored prior outputs. Retries respect the same key-pool rotation as a fresh call — not guaranteed to hit the same key that failed.

**Bulk mode:** each artwork is its own job with its own status; one item failing doesn't halt or roll back the rest. The history log shows per-item status within a batch.

**Idempotency:** re-running a module overwrites that module's prior output for the job rather than creating duplicates (enforced at the DB level via `UNIQUE(job_id, module_name)` / `UNIQUE(job_id, variation)` / `UNIQUE(job_id, product_size_id)`).

---

## Stack

- **Frontend:** React. **Backend:** Node.js.
- **Local-first, local-persistent deployment target — not serverless.** The app runs as a persistent local process (`node server.js`, or a small home server), for three reasons tied to features already built: (1) the folder-watcher needs a continuously-running process on the machine where Midjourney downloads land; (2) local DB and mockup/artwork storage need persistent disk, which serverless platforms don't provide; (3) Module 7's CLIP embedding process needs a long-lived local process, not a stateless function call.
- **Secrets:** local `.env` (Gemini key pool, optional Claude key), gitignored; `.env.example` ships as a template.
- **Database:** SQLite. `pipeline_config` and backups stay as JSON/files, not tables.
- **Local embedding model:** `onnxruntime-web` (WASM) running `Xenova/clip-vit-base-patch32`, in-process in the Node backend (Module 7).
- **Provider layers:** three swappable interfaces — `lib/llm/`, `lib/trends/`, `lib/tags/` — each config-selected, so any can be flipped without touching module code.

---

## Database Schema

SQLite. `pipeline_config` and backups stay as JSON/files, not tables.

**Core pipeline**
- `artworks` — id, file_path, original_filename, image_analysis (JSON from Module 1), uploaded_at
- `jobs` — id, artwork_id (FK), overall_status, manual_notes (Module 2's fallback input), batch_id (nullable — shared by every job from the same multi-file drop, indexed), created_at, updated_at
- `job_modules` — id, job_id (FK), module_name, status, error_message, retry_count, started_at, completed_at. `UNIQUE(job_id, module_name)`
- `listings` — id, job_id (FK), variation (fine_art/aesthetic/gift), title, description, tags (JSON array of 13), tag_alternates (JSON array of 5), edited_at. `UNIQUE(job_id, variation)`
- `mockups` — id, job_id (FK), product_size_id (FK), file_path (currently-selected variant), status, ai_extended_path (nullable), smart_crop_path (always set, independent of `file_path`), needs_review (0/1), selected_variant (`smart_crop` | `ai_extended`, default `smart_crop`). `UNIQUE(job_id, product_size_id)`

**Config-as-data**
- `product_sizes` — id, size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer (nullable, PSD-only) — shared source of truth for Modules 2 & 3
- `tags` — id, tag_text, category, source
- `settings` — key, value (default price, delivery text, shop conventions, watcher config)

**LLM provider layer**
- `llm_rate_limits` — key_index, model, limited_until, consecutive_hits (doubles per consecutive 429, resets on success), reason (nullable), updated_at. `UNIQUE(key_index, model)`

**Trends (Module 4)**
- `trends` — id, term, category, source (manual/csv/etsy_api), added_at
- `prompts` — id, trend_id (FK, nullable), category, prompt_text, created_at

**Taste model (Module 7)**
- `image_preferences` — id, image_path (**unique** — one row per image; `POST /api/taste-filter/label` and the auto-compute decision path both upsert on it, so a relabel or a manual correction of an auto-decided row updates it in place rather than adding a second row), embedding (BLOB), label (keep/discard), category, prompt_id (FK, nullable), promoted_artwork_id (FK, nullable), auto_labeled (0/1 — set when a row was written by auto-compute rather than a manual click; cleared back to 0 by a manual correction), created_at
- `taste_centroids` — id, category (NULL = global), kept_centroid (BLOB), discarded_centroid (BLOB), updated_at
- `prompt_terms` — term, kept_count, discarded_count, updated_at

**Indexes:** `job_modules(job_id)`, `listings(job_id)`, `mockups(job_id)`, `image_preferences(category)`, `image_preferences(image_path)` (**unique**), `trends(term)`.

**Cascade behavior:** deleting a `job` cascades to its `job_modules`, `listings`, and `mockups`. `artworks`, `image_preferences`, `trends`, and `tags` are never cascade-deleted — they're independent reference data.

---

## Differences from the original plan

| Original plan | This version |
|---|---|
| Etsy API pulls trending data | Trends are manually selected/maintained |
| Canva API or Pillow for mockups | Single `mockup-generator.js`, user's own mockup templates via config lookup |
| Claude API as the only LLM | Gemini (multi-key pool) as primary LLM, Claude as optional fallback behind a shared provider interface |
| Fixed phase order, all-or-nothing | Modular: any step can be enabled/disabled per run |
| Implicit "must deploy" | Local-first; deployment is a later, separate decision |
| Tags freely generated | Tags chosen from a pre-made list, matched to image content |
| Etsy API auto-upload (Module 5) | Removed. Publishing to Etsy is manual — no Etsy API integration, no OAuth |
| Trends/tags hardcoded to their source | Both sit behind swappable provider interfaces, manual by default, flippable via config |

---

## Packaging & Deployment

- **Local persistent deployment** (own machine or small home server) — the primary target.
- **Electron packaging (Windows exe)** — done and CI-build-verified via `electron-builder` (`.github/workflows/release.yml`, `package-electron-win` job). Electron wraps the existing React frontend and spawns the existing Node backend as a child process; packaged mode runs the backend under Electron's own bundled Node (`ELECTRON_RUN_AS_NODE=1`, not a system Node install) and points data paths (`DB_PATH`, uploads, candidates, mockup output) at `app.getPath('userData')`. `better-sqlite3` is rebuilt against Electron's ABI via `@electron/rebuild` during packaging, with its native binary unpacked from the asar archive (`asarUnpack`).
- **Known gotcha for monorepo/workspace packaging:** electron-builder determines "production dependencies" by walking the *app manifest's* (root `package.json`'s) own `dependencies` field, not by following npm workspace hoisting into `backend/package.json`. Root `package.json` therefore carries its own `dependencies` block mirroring backend's runtime deps, so electron-builder's dependency walk actually finds and copies them (`express`, `better-sqlite3`, `jimp`, `chokidar`, `onnxruntime-web`, `ag-psd`, etc.) — otherwise the packaged backend fails at its first `require()`. **Accepted maintenance tradeoff:** this duplicates the dependency list in two `package.json` files, which can drift if one is updated without the other; not worth automating away for an ~11-entry list right now.
- **Unsigned installer:** the Windows exe is unsigned, so first run shows a SmartScreen "Windows protected your PC" warning (click "More info → Run anyway"). Not a blocker for personal use; code-signing is a separate, optional later decision if the exe is ever shared beyond personal use.
- `package-local-bundle` (tarball) and `package-electron-win` (NSIS installer) both publish to the same tagged GitHub Release on `v*.*.*` pushes; a `workflow_dispatch` run never publishes (gated to `refs/tags/*`).

---

## Testing & CI/CD

**Test suite:**
- Unit tests (Vitest) for the swappable provider layers and for logic that's easy to silently break — partial failure handling, retry behavior, idempotency on re-running a module.
- Integration tests (Supertest) against the backend's API routes, run against a throwaway test DB (in-memory/temp-file SQLite) — covering every module's routes, the server-side pipeline runner, and config routes.
- **Playwright E2E** (`e2e/critical-path.spec.js`) — critical path only (upload → generate → review → copy), against a real backend running `LLM_PROVIDER=fixture` (a deterministic third provider, no network call, no output variance — `backend/lib/llm/fixture.js`). Run via `npm run test:e2e`.

**CI** (`.github/workflows/ci.yml`) — on every push/PR into `main`: `install` (cached), then parallel `lint`, `backend-test`, `electron-test` (mocked, no real Electron runtime), `frontend-test`, `frontend-build`. E2E is deliberately *not* in this workflow — it runs on a schedule/on-demand via `.github/workflows/e2e.yml` instead, so a full-browser run against two live dev servers never gates a normal push/PR.

**CD** (`.github/workflows/release.yml`) — triggers on `v*.*.*` tags: `verify` re-runs the CI gate, then `package-local-bundle` and `package-electron-win` run in parallel and publish to the same GitHub Release (see Packaging & Deployment above).

**CI/CD Limitations — Packaged App Testing:** The release workflow builds the Windows installer and verifies that critical files (frontend/dist, backend, native modules) are present in the asar, but does NOT end-to-end test the packaged app (i.e., actually run it to confirm startup and health-check). v0.11.3/v0.11.4 shipped with broken installers because the release workflow was missing the frontend-build step; this was caught manually, not by CI. Mitigated in v0.11.5+ with improved sanity-checks and a preventative check ensuring the npm script includes the build step, but automated smoke-testing of the installed app would be the strongest safeguard.

---

## Open Risks — Reviewed, Accepted As-Is

- **AI-disclosure content policy** (Module 2 hardcodes "no AI disclosure in descriptions") — reviewed and accepted; no change needed.
- **Multi-key Gemini ToS risk** (rotating a pool of free-tier keys) — reviewed; not a current concern. May move to a paid Gemini Pro key later, decision deferred until then.

## Open Discussions — Not Yet Decided

- **Unsigned Windows exe / SmartScreen** — see Packaging & Deployment above. Code-signing deferred until/unless the exe is shared beyond personal use.

---

## Future Consideration — Full Midjourney Submission Automation (not planned)

Two separate things get conflated under "automate Midjourney":
1. **Exporting generated images into the dashboard** — safe, already built (watched-folder auto-import, Module 7). No ToS exposure, since it never interacts with Midjourney.
2. **Auto-submitting prompts to Midjourney itself** (its Discord bot or web app, whether via a script or an AI browser/computer-use agent) — a materially different thing. There is no official public Midjourney API; the only way to submit prompts programmatically is by automating its Discord/web interface, which Midjourney's ToS prohibits regardless of what drives the clicking.

**Decision: not building #2.** Prompt submission stays manual — the user pastes Module 4's generated prompts into Midjourney themselves. Revisit only if Midjourney ships an official public API, or the user explicitly decides to accept the account-ban risk of an unofficial automation route.
