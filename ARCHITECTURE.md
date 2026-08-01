# ProEtsy — Modular Architecture

This document defines the modular version of the original build plan. It supersedes nothing — the original plan doc stays as-is — but this is the spec to build against: React frontend, Node.js backend, runnable fully locally first, deployable later.

**LLM provider: Gemini (free tier, multiple keys) is primary and native** — nothing has been built yet, so there's no migration or output-normalization concern; Modules 1, 2, and 4 are designed against Gemini's response format from the start. Claude API is kept as an optional fallback behind the same interface, not required to run the app.

## Guiding principles

- **Modular**: every pipeline stage is a self-contained module with a defined input/output contract. Any module can be swapped, disabled, or replaced without touching the others.
- **Local-first**: the whole app must run end-to-end on a dev machine (local DB, local file storage, no cloud deploy required) before any hosting decision is made.
- **Steps are optional**: each pipeline run is driven by a config (with UI override) that says which modules run, in what order, and which are skipped.
- **No auto-generation where the user already has assets**: mockups use the user's own templates, not Canva/Pillow generation. Trend data is manually selected, not scraped.

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

Etsy publishing is manual by design — no auto-uploader module. The app's job ends at producing an approved, ready-to-copy listing (and mockups); the user pastes it into Etsy themselves. Every arrow above the final step is a toggle point. A run can go straight from upload → listing generator → manual copy-paste, skipping mockups entirely (this is Phase 1 / the "quick win"). Module 7 is a separate, earlier gate for raw Midjourney output — it never touches the main listing pipeline directly; its only output is a ranked/labeled set of images, some of which then get dragged into the main pipeline as "Upload Artwork."

---

## Modules

### Module 1 — Image Analyzer (optional)
**Input:** artwork file
**Output:** structured description (subject, style, palette, mood) used by Module 2 and for tag matching
**Tech:** Gemini API (vision, multimodal) via the LLM provider layer
**Can be skipped if:** user wants to hand-write listing angle/keywords instead

### Module 2 — Listing Generator (core, not skippable)
**Input:** image analysis (or manual notes if Module 1 skipped) + selected trend (manual) + tag library
**Output:** 3 listing variations (fine art/decor, aesthetic/trend, gift angle), each with title, description, tags
**Must hardcode shop conventions:**
- Title separator: `|`
- Max title length: 140 characters
- Tags per listing: 13 (+5 alternatives), max tag length 20 characters
- No frames mentioned in titles
- No AI disclosure in descriptions
- No delivery details in descriptions
- Sizes referenced in the listing come from the shared **product-sizes config** (see Module 3) — not a hardcoded list. Only sizes that have a matching mockup template configured are offered/mentioned.
**Tag selection:** calls the **tags provider layer** (see below), not a hardcoded source — currently backed by the user's pre-made tag list, matched to image analysis output
**Tech:** Gemini API via the LLM provider layer

### Module 3 — Mockup Composer (optional)
**Input:** artwork file + product type (e.g. "8x10 print", "square canvas")
**Output:** composited mockup image(s), in the shop's defined display order
**Tech:** a single `mockup-generator.js` file. No Canvas/Pillow/Canva API.
**Aspect-ratio mismatch handling:** when the artwork's aspect ratio doesn't match the target template, the composer picks between two approaches based on how large the mismatch is — never a blind center-crop, never letterbox/pad:
- **Small mismatch → content-aware smart crop.** Uses `smartcrop.js` (pure JS, no native deps — works on Termux) to detect the actual subject/focal region and crop around it, instead of blindly cutting from center.
- **Large mismatch → AI outpainting via Gemini.** When a crop would lose meaningful content, the artwork is sent to Gemini's image model (2.5/3 Flash Image, "Nano Banana") to generatively extend the canvas to the target aspect ratio — the model fills in plausible, stylistically-matched content around the original rather than cropping it away or padding with blank space. Same Gemini provider layer already used by Modules 1/2/4; free tier covers this (~500 requests/day as of early 2026).
- **Review step:** when both approaches are viable, the dashboard shows the smart-crop and AI-extended versions side by side and the user picks — consistent with the pipeline's human-in-the-loop principle. Smart-crop is always the fallback if an outpaint attempt looks wrong, so a bad AI result never blocks the pipeline.
- Reads the shared **`product-sizes.json` config** — one entry per size, e.g.:
  ```json
  {
    "8x10-portrait": { "dimensions": "8x10", "dpi": 300, "orientation": "portrait", "mockup_template": "templates/8x10-frame.png" },
    "square-canvas":  { "dimensions": "12x12", "dpi": 300, "orientation": "square",   "mockup_template": "templates/square.png" }
  }
  ```
- Given `(artworkPath, productType)`, looks up the matching entry and composites the artwork into its template
- **This same config is the single source of truth for Module 2** — no separate hardcoded size list. A size only shows up as sellable/mentionable once it has an entry here (dimensions, DPI, and a mockup template).
- New product types/templates/sizes are added by editing this one config, not the code, and not duplicated anywhere else

### Module 4 — Trend/Prompt Helper (optional, manual-trend version)
**What changed from the original plan:** no live Etsy trend-pulling API call. Module 4 calls the **trends provider layer** (see below), currently backed by a manually maintained/selected list (e.g. a `trends.json` or a dropdown in Settings) that the user updates themselves.
**Input:** selected trend + desired category
**Output:** ready-to-paste Midjourney prompts using shop conventions (`--v 7`, `--style raw`, aspect ratio per category, `--s 50–150`)
**Tech:** Gemini API via the LLM provider layer, no Etsy API dependency. (This module only *writes* Midjourney-formatted prompt text — it never calls a Midjourney API.)

### Module 7 — Taste Filter (Curation) (optional, pre-pipeline)
**What it does:** Ranks a batch of raw Midjourney-generated candidates against a learned taste profile, so obvious "slop" gets flagged before it ever becomes a listing candidate.
**Input:** a batch of candidate images (generated manually in Midjourney, dragged into the dashboard)
**Output:** each candidate gets **two taste scores** — a global score and a per-category score — plus a suggested label (likely-keep / likely-discard / uncertain). Nothing is auto-deleted — the user confirms keep/discard, and that confirmation is the training signal.
**Tech:** local image embeddings via a **JS-only CLIP implementation** — `onnxruntime-web` (WASM execution provider) running the pre-converted **`Xenova/clip-vit-base-patch32`** ONNX model (OpenAI CLIP, already exported for JS runtimes, MIT-licensed — no conversion work needed), called directly from the Node backend (not a child process, not a separate Python script). No API key, no per-request cost, no network dependency, and no second runtime to manage — everything (backend, frontend, embeddings) stays in one Node process.
**Why WASM over native (`onnxruntime-node`):** no prebuilt native binary to match against a specific libc/ABI, which buys two things: (1) it runs on Termux/Android as-is, since `onnxruntime-node`'s prebuilt binaries target glibc and don't work against Android's Bionic libc and cross-compiling the Node bindings for Termux has proven impractical; (2) it sidesteps Electron's native-module rebuild step (`electron-rebuild`) entirely for later packaging, since there's no native addon whose ABI needs to match Electron's bundled Node version. Trade-off: WASM CPU inference is slower than native for batch scoring — acceptable for single-user, one-batch-at-a-time use, but don't expect instant results scoring a large Midjourney batch.
**How the "training" works:**
- Every keep/discard decision is stored as a labeled example (embedding + label + category, e.g. portrait/landscape/square) in an `image_preferences` table
- **Two sets of centroids are maintained:** a **global** kept/discarded centroid pair (across all categories), and a **per-category** kept/discarded centroid pair for each product category (from the shared product-sizes config)
- A new candidate gets scored against both: global score = similarity to global-kept centroid minus global-discarded centroid; category score = the same calculation using only that candidate's category's centroids
- Both scores are shown side by side — global for quick overall sorting, category for catching cases where something scores fine globally but is off for its specific style bucket
- **Recompute is both automatic and on-demand:** centroids recompute automatically after every labeled batch, and a **"Recompute now" button** in the dashboard triggers an immediate recompute (e.g. after relabeling older images) without waiting for the next batch
- **Cold start:** with only a handful of labels, the system shows scores but doesn't filter confidently; a few dozen labeled examples is typically enough for this kind of centroid scoring to become useful. Per-category scores need cold-start tolerance per category too, since a category with few labels will be less confident than one with many
**Never auto-discards:** consistent with the rest of the pipeline's human-in-the-loop principle — this only ranks and flags, the user always confirms
**Can be skipped if:** the user is hand-picking Midjourney output already and doesn't want the extra step

**Prompt-feedback link to Module 4 (optional, opt-in):**
Module 7's embeddings and Module 4's text prompts don't share a representation, so the link between them isn't the embeddings themselves — it's tracking **which prompt terms tend to produce kept vs. discarded images**:
- Each imported candidate is tagged with the prompt (or prompt components: subject, style words, medium) that generated it
- As keep/discard labels accumulate, the system tallies which recurring prompt terms show up disproportionately in "kept" images vs. "discarded" ones
- Module 4 can optionally pull a short "terms that have worked well" list as a style hint alongside the selected trend/category — it biases Gemini's word choices toward what's historically landed, it does not override the user's manual trend selection or dictate the whole prompt
- This is secondary and opt-in: Module 4 works exactly as before if this is turned off

**Future (planned, not built yet): auto-import via watched folder.**
Once Midjourney generates and downloads images to a local folder, a lightweight file-watcher can detect new files and automatically pull them into Module 7's queue — no manual drag-and-drop needed for the *import* step. This is pure local file-system watching (chokidar or similar), no API call, no network dependency, no Midjourney ToS exposure at all, since it never touches Midjourney's systems. Safe to build whenever it's prioritized.

**Activation: a toggle in the dashboard Settings panel** (e.g. "Auto-import from folder: on/off" + a folder-path field), not always-on by default. Off by default keeps behavior predictable; the user turns it on once they've set the watched folder path.

**The closed loop — how auto-import + Module 7 + self-improvement fit together:**

```
[Manual: paste Module 4's prompt into Midjourney, generate images]
              ↓
[Midjourney downloads land in a local folder]
              ↓
[Auto-import: file-watcher detects new files → pulls into Module 7 queue]
              ↓
[Module 7 scores each image against the CURRENT taste model]
              ↓
[Dashboard shows ranked batch: likely-keep / likely-discard / uncertain]
              ↓
[User reviews, confirms keep/discard on each]
              ↓
[Every confirmation → new labeled row in image_preferences → centroids recomputed]
              ↓                                                    ↑
[Kept images flow into "Upload Artwork" → main pipeline]    (model gets sharper
   (Module 1 → 2 → 3 → review → manual Etsy publish)         for the NEXT batch)
```

Nothing extra needs to be built to make this "self-improving" — every keep/discard decision the user is already making becomes training data automatically, so each new batch is scored against a slightly better model than the last one. There's no separate training mode; labeling *is* the training. It also never "finishes" training — it keeps adapting as the user keeps labeling, so it drifts with taste changes over time rather than freezing on an early snapshot.

### Module 5 — Etsy Uploader
**Removed.** Etsy publishing is manual — the user copies the approved listing text and mockups into Etsy themselves. No Etsy API v3 integration, no OAuth, no bulk-publish. This removes the biggest external-account risk from the whole build (Etsy developer approval, bulk-publish bugs, API changes) and the module entirely.

### Module 6 — Control Dashboard (core, not a pipeline step)
React frontend that:
- Lets the user drag-and-drop artwork
- Shows a **pipeline config panel**: toggle which modules run for this job (mirrors the config default, but overridable per run)
- Previews and allows editing any generated field before publishing
- Supports bulk mode (multiple artworks through the pipeline at once)
- Keeps a listing history log
- Settings panel: default price, delivery text, shop style conventions, tag library, trend list, product-sizes config (dimensions, DPI, mockup template per size)
- Provides an easy **copy-to-clipboard / export** view per listing (title, description, tags, mockup files) so pasting into Etsy manually is fast

---

## First-Run Setup

No separate installer or CLI wizard — the app detects its own setup state on launch and drives the dashboard accordingly.

**Detection:** on backend startup, check for (1) at least one Gemini key in `.env`, (2) an initialized DB, (3) at least one entry in `product-sizes.json`. If any are missing, the dashboard opens directly into a setup screen instead of the normal UI.

**Setup steps, ordered by what's actually required:**
- **Required to run at all:** at least one Gemini API key, entered in the setup screen and saved to `.env` (never committed — same pattern as the existing `.env.example`). DB schema auto-creates with no user action.
- **Required for Module 2 (core):** a starter tag list — paste a list or upload a CSV, not one-at-a-time entry.
- **Required for Module 3 (optional but likely wanted):** at least one product size + mockup template pair, since nothing is offered until one exists.
- **Skippable entirely:** trends list, additional Gemini keys, Claude fallback key — the app runs fine with just the three items above.

**Persistent status, not just a one-time modal.** The same three checks live permanently in the dashboard's Settings panel as a ✅/⚠️ setup-status list, so anything skipped initially (or missing after moving to a new machine) stays visible without re-triggering the full wizard.

**Fail loud, not silent.** If a module runs without its required setup item (e.g. Module 2 with no Gemini key configured), the error points directly at the setup screen rather than surfacing a generic API error.

---

## Local Backup

All data lives only on the local machine (DB, `image_preferences` taste model, tag library, mockup templates, configs), so backups are local-to-local for now (a separate off-machine/cloud copy is not in scope here):

- **Scheduled job inside the existing Node process.** A `node-cron` job (e.g. nightly) snapshots the DB and zips it together with `uploads/`, `templates/`, and the config files (`product-sizes.json`, `trends.json`, `pipeline.config.json`) into a timestamped archive in a local backup folder. No OS-level cron needed since the app already runs as a persistent process.
- **Retention/rotation.** Keep the last 7 daily archives plus the last 4 weekly ones; delete anything older so the backup folder doesn't grow unbounded.
- **"Backup now" button.** Same pattern as Module 7's "Recompute now" button — a manual trigger in the dashboard Settings panel to force an immediate backup before a risky operation (e.g. relabeling a large batch), without waiting for the nightly job.

---

## Step control model

Two layers, both required:

1. **Config default** — a `pipeline.config.json` (or similar) in the backend defines, per shop/default setup, which modules are enabled and in what order.
2. **UI override** — the dashboard reads that config as the default toggle state for a new job, but the user can flip any module on/off before running that specific job. Overrides apply to that run only; they don't rewrite the config file unless the user explicitly saves it as the new default.

Example shape:
```json
{
  "pipeline": [
    { "module": "image_analyzer", "enabled": true },
    { "module": "listing_generator", "enabled": true, "required": true },
    { "module": "mockup_composer", "enabled": true }
  ]
}
```

(No `etsy_uploader` entry — that module has been removed. Publishing is manual.)

---

## Trends Provider Layer (built in v1)

Module 4 (and Module 2, for trend-aware listing angles) calls a shared interface instead of a hardcoded source:

```
lib/trends/
  index.js         -> exports getTrends(), chosen by config
  manual.js         -> reads trends.json / dashboard-entered list (v1 implementation)
  etsy-api.js       -> pulls a lightweight signal from Etsy's official Open API v3 (built)
  etsy-scraper.js   -> future: scraping a tool's site directly (not built, rejected — see below)
```

**v1 implementation: manual (informed by external research tools), plus an Etsy Open API v3 signal.** There's no public API for real trend/search-volume analytics: Etsy's own API doesn't expose that, and the popular third-party research tools (eRank, Marmalead, Alura, EverBee, EtsyHunt, Sale Samurai) are closed dashboards/browser extensions built for a human to browse, not developer APIs.

Two complementary, ToS-clean pieces instead of pure hand-typing:
- **`etsy-api.js`** calls Etsy's official, sanctioned Open API v3 public listing-search endpoint (API key only, no OAuth needed for public search) for a chosen keyword/category, and computes a rough self-generated signal — which tags/words show up most often across recently-active, highly-favorited listings. This is not real trend/search-volume data, just a lightweight proxy, but it's built on an endpoint Etsy explicitly wants developers to use, unlike scraping its site or a third-party tool's interface.
- **CSV import in `manual.js`.** The user still checks a tool like eRank or EverBee's free tier themselves, but instead of hand-typing findings into `trends.json`, they export that tool's own list as CSV and import it via a button in the dashboard. Same manual, ToS-clean entry point as before — the tool's own export feature, not automation against its interface — just less tedious.

`etsy-scraper.js` (an actual scraper hitting Etsy's or a tool's site directly, as opposed to `etsy-api.js`'s sanctioned endpoint) stays undocumented/unbuilt for the same reason as the Midjourney auto-prompt decision above: it would mean automating a site's interface against likely ToS terms, carrying account/IP-block risk. Revisit only if one of these tools ever ships a public developer API, or if the user explicitly decides to accept that risk.

Flipping providers, or combining `etsy-api.js`'s signal with the manual/CSV list, is a config change (`TRENDS_PROVIDER=etsy-api`), not a rewrite of Module 4.

---

## Tags Provider Layer (built in v1)

Module 2's tag selection calls a shared interface instead of reading the tag list directly:

```
lib/tags/
  index.js          -> exports getTagCandidates(imageAnalysis), chosen by config
  user-list.js       -> matches against the user's pre-made tag list (v1 implementation)
  auto-suggest.js    -> future: suggests new tags from trend/market data (not built)
```

**v1 implementation: user-list.** Tags are chosen from the user's pre-made tag library, matched against Module 1's image analysis output — never freely generated. Flipping to an auto-suggest source later is a config change, not a Module 2 rewrite.

---

## LLM Provider Layer

All three LLM-using modules (1, 2, 4) call a single shared interface instead of hitting a provider's SDK directly:

```
lib/llm/
  index.js       -> exports generateText(), generateVision(), chosen by config
  gemini.js      -> Gemini implementation (primary)
  claude.js      -> Claude implementation (optional fallback)
```

**Primary: Gemini, multiple free API keys.**
Gemini's free tier is rate-limited per project/key (as low as 5-15 requests/minute and roughly 100-1,000 requests/day depending on model, as of mid-2026 — check Google AI Studio's current numbers before relying on this). To stay within free limits at real usage volume, the provider layer supports a **pool of Gemini API keys** rather than a single key:

- Keys are listed in config/env (e.g. `GEMINI_API_KEYS=key1,key2,key3`), not hardcoded
- The provider layer rotates keys round-robin per request
- On a 429 (rate-limit) response, it retries with the next key in the pool before failing
- If all keys are exhausted, the call fails clearly (surfaced in the dashboard) rather than hanging — no silent fallback to Claude unless that's explicitly enabled in config

**Model cascade within a key (checked before rotating keys).** A single Gemini key isn't just tried against one model — it's tried against a **priority-ordered list of models** first, and only after every model on that list has failed (429 or other retryable error) on the *current* key does the provider layer move to the *next* key and restart from the top of the model list:

- Model priority list is config/env-driven, e.g. `GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-pro` (Flash-tier first for headroom, Pro-tier last since its free-tier caps are far tighter — see "Model choice" below)
- **Loop order is: for each key → for each model (in priority order) → attempt call.** So a 429 on `key1`/`gemini-2.5-flash` first retries as `key1`/`gemini-2.0-flash`, then `key1`/`gemini-2.5-pro`, and only once every model on `key1` has 429'd does it move to `key2`/`gemini-2.5-flash`
- Rationale: a key's rate limit is typically per-model on Google's side, so a model that's rate-limited on a given key doesn't mean the *key* itself is exhausted — a different model on that same key may still have headroom. Rotating keys before exhausting a key's own model options would burn through the key pool faster than necessary
- A call can pin a single model (skipping the cascade for that call) via `options.model` — used for calls that specifically need Pro-tier reasoning and shouldn't silently downgrade to Flash
- If every model on every key in the pool has failed, the call fails clearly (surfaced in the dashboard), same as the key-exhaustion case above

**Fallback: Claude.** Same interface, disabled by default. Can be turned on in config if the entire Gemini key×model cascade is exhausted, or for a specific module that needs it, without changing any module code.

**Model choice on the Gemini side:** favor a Flash-tier model for the higher daily/rate-limit headroom; reserve a Pro-tier model only for calls that need stronger reasoning, since Pro's free-tier caps are far tighter. This preference is what the `GEMINI_MODELS` priority order encodes.

**Data note:** Gemini's free tier may use inputs/outputs to improve Google's models. Since Module 1 sends artwork images and Module 2 sends shop copy through it, factor that into whether free tier is acceptable for this data, or whether a paid tier / different privacy setting is needed later.

---

## Partial Failure Handling

Every pipeline run is tracked as a **job**, and every module within a job has its own status — a failure in one module doesn't corrupt or block the rest of the job, and one job's failure doesn't block other jobs.

**Per-module status** (per job): `pending` → `running` → `success` | `failed` | `skipped`

**Job-level rules:**
- If **Module 1** (Image Analyzer) fails, the job pauses and asks the user for manual notes instead of auto-failing the whole job — Module 1 is optional, so a failure here shouldn't block Module 2.
- If **Module 2** (Listing Generator) fails, the job stops there and is marked `failed` — Module 2 is core/required, nothing downstream can run without it. The user sees the error and can retry just that module (not the whole job).
- If **Module 3** (Mockup Composer) fails (e.g. missing template for a product type), the job still surfaces the generated listing for review — mockups are optional, so a listing without mockups is still usable. The failure is flagged, not hidden.
- If **Module 4** (Trend/Prompt Helper) fails, it's fully isolated — it's not part of the main listing pipeline, so a failure there never touches jobs in progress.

**Retry model:**
- Each failed module gets a **retry button** in the dashboard — retrying re-runs only that module, using the job's already-stored inputs/outputs from prior successful steps (no need to re-upload the artwork or re-run steps that already succeeded).
- Retries against Gemini respect the same key-pool rotation as a fresh call (see LLM Provider Layer above) — a retry isn't guaranteed to hit the same key that just failed.

**Bulk mode:**
- Each artwork in a bulk batch is its own job with its own status. One item failing (e.g. a bad image file, a Gemini timeout) does not halt or roll back the rest of the batch.
- The dashboard's listing history log shows per-item status within a batch, so failures are visible at a glance rather than buried in a single pass/fail for the whole batch.

**Idempotency:**
- Re-running a module for a job overwrites that module's prior output for the job rather than creating duplicates (e.g. re-running Module 3 replaces the old mockup file reference, it doesn't add a second copy).

---

## Stack

- **Frontend:** React
- **Backend:** Node.js
- **Local-first:** entire pipeline (analyzer → generator → mockup composer → review) must run against local storage/local DB before any deployment decision.
- **Deployment target: fully local.** The app runs as a persistent local process (`node server.js`, or a small always-on home server/mini PC), not a serverless platform. This isn't a temporary starting point — it's the actual target, for three concrete reasons tied to features already built into the plan: (1) the folder-watcher needs to run continuously on the same machine where Midjourney downloads land, which is inherently local; (2) local DB and local mockup/artwork storage need persistent disk, which serverless platforms don't provide (each invocation gets an ephemeral filesystem); (3) Module 7's CLIP embedding process needs a long-lived local process to invoke, not a stateless function call. Vercel (and similar serverless hosts) isn't a fit for this design unless those three things were rearchitected around cloud storage and a hosted embedding API — not planned.
- **Secrets:** stored in a local `.env` file (Gemini key pool, optional Claude key), not hardcoded. A `.env.example` ships in the repo as a template; the real `.env` is gitignored.
- **Database:** same tables as the original plan (listings, images, mockups, tags, settings, prompts), plus a `trends` table (manual entries), a `pipeline_config` table/JSON file, a `jobs` table (job id, per-module status, error messages, timestamps) to support partial failure handling, a `product_sizes` table/config (dimensions, DPI, mockup template per size — shared by Modules 2 and 3), an `image_preferences` table (image reference, embedding vector, keep/discard label, category, prompt reference, timestamp) for Module 7's taste model, and a `prompt_terms` table (term, kept count, discarded count) for the optional Module 7 → Module 4 prompt-feedback link.
- **Local embedding model:** `onnxruntime-web` (WASM) running `Xenova/clip-vit-base-patch32`, for Module 7. JS-only — no Python runtime, no API key, no cost, no network call. Runs in-process within the Node backend, not a separate child process. WASM (not the native `onnxruntime-node` binary) so the same code runs unmodified on Termux/Android and packages cleanly into Electron later without a native-module rebuild step.
- **LLM keys:** a pool of Gemini API keys (env/config, not hardcoded), plus an optional single Claude key for fallback.
- **Provider layers:** three swappable interfaces built in v1 — `lib/llm/`, `lib/trends/`, `lib/tags/` — each with a config-selected implementation, so any of the three can be flipped later without touching module code.

---

## Database Schema

SQLite (matches the local-first, local-DB decision above). `pipeline_config` and backups stay as JSON/files, not tables.

**Core pipeline**
- `artworks` — id, file_path, original_filename, image_analysis (JSON from Module 1), uploaded_at
- `jobs` — id, artwork_id (FK), overall_status, created_at, updated_at
- `job_modules` — id, job_id (FK), module_name, status (pending/running/success/failed/skipped), error_message, retry_count, started_at, completed_at. **`UNIQUE(job_id, module_name)`** — re-running a module updates this row rather than inserting a second one, which is what makes the idempotency rule in Partial Failure Handling actually hold at the DB level.
- `listings` — id, job_id (FK), variation (fine_art/aesthetic/gift), title, description, tags (JSON array of 13), tag_alternates (JSON array of 5), edited_at. `UNIQUE(job_id, variation)` for the same idempotency reason.
- `mockups` — id, job_id (FK), product_size_id (FK), file_path, status. `UNIQUE(job_id, product_size_id)` — re-running Module 3 for a size replaces the file reference, not a duplicate row.

**Config-as-data**
- `product_sizes` — id, size_key, dimensions, dpi, orientation, mockup_template_path (shared source of truth for Modules 2 & 3)
- `tags` — id, tag_text, category, source (the tag library Module 2 matches against)
- `settings` — key, value (default price, delivery text, shop conventions)

**Trends (Module 4)**
- `trends` — id, term, category, source (manual/csv/etsy_api), added_at
- `prompts` — id, trend_id (FK, nullable), category, prompt_text, created_at

**Taste model (Module 7)**
- `image_preferences` — id, image_path, embedding (BLOB), label (keep/discard), category, prompt_id (FK, nullable — links to the prompt that generated it), promoted_artwork_id (FK, nullable — set if this image later got dragged into Upload Artwork), created_at
- `taste_centroids` — id, category (NULL = global), kept_centroid (BLOB), discarded_centroid (BLOB), updated_at (cached, recomputed on relabel/schedule rather than calculated fresh every score)
- `prompt_terms` — term, kept_count, discarded_count, updated_at (the Module 7 → Module 4 feedback link)

**Indexes:** beyond the uniqueness constraints above, index `job_modules(job_id)`, `listings(job_id)`, `mockups(job_id)` for the dashboard's per-job status lookups, and `image_preferences(category)` and `trends(term)` for the lookups Module 7 and Module 4 do most often.

**Cascade behavior:** deleting a `job` cascades to its `job_modules`, `listings`, and `mockups` rows — there's no scenario where those should outlive the job they belong to. `artworks`, `image_preferences`, `trends`, and `tags` are never cascade-deleted by a job/prompt deletion, since they're reference data the taste model and tag matching depend on independently.

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
| Trends/tags hardcoded to their source | Both sit behind swappable provider interfaces (`lib/trends/`, `lib/tags/`), manual by default, flippable to a scraper/auto-suggest source later via config |

---

## Suggested build order

1. **Local skeleton** — ✅ done: React frontend + Node backend running locally, DB schema in place, pipeline config wired up (modules currently stubbed), plus the three provider-layer interfaces (`lib/llm/`, `lib/trends/`, `lib/tags/`) scaffolded with their v1 implementations
2. **Module 2** (Listing Generator) — core, get this solid first, matches original Phase 1
3. **Module 3** (Mockup Composer with own templates) — no external mockup API needed, so this can move up earlier than the original plan's Phase 2
4. **Module 4** (manual-trend prompt helper) — low complexity now that trend-pulling is removed
5. **Local persistent deployment** — running the finished app as an always-on local process (own machine or a small home server); not a cloud/serverless deployment (see Stack section)
6. **Electron packaging (Windows exe)** — once the app is fully working as a normal local web app (steps 1-5), wrap it with `electron-builder` into a Windows installer/exe. Electron's window points at the existing React frontend and spawns the existing Node backend as a child process inside the packaged app. This is a packaging step at the end, not an architectural change — nothing upstream needs to be built "Electron-aware" except the JS-only CLIP decision (Module 7) already made for exactly this reason, avoiding a bundled Python runtime.

(Etsy Uploader is no longer part of the build — publishing is manual.)

---

## Testing & CI/CD

**Test suite:**
- Unit tests (Vitest) for the swappable provider layers (`lib/llm/`, `lib/trends/`, `lib/tags/`) and for pipeline logic that's easy to silently break — partial failure handling, retry behavior, idempotency on re-running a module.
- Integration tests (Supertest) against the Node backend's API routes, run against a throwaway test DB (in-memory or temp-file SQLite) so tests never touch the real local DB.
- A small set of Playwright end-to-end tests covering the critical path only (upload artwork → generate listing → review → copy-to-clipboard) rather than exhaustive UI coverage.

**CI (GitHub Actions):**
- On every push/PR: install, lint, run unit + integration tests.
- E2E tests run on a schedule (e.g. nightly) or on demand, since they're slower and matter most right before a release rather than on every commit.

**CD (packaging, not deployment):**
- No cloud deploy target since the app is local-only by design — "CD" here means the Electron packaging step, not shipping to a server. On a tagged release, a GitHub Actions workflow runs `electron-builder` and attaches the resulting Windows installer/exe as a release artifact automatically, rather than building it by hand each time.

---

## Open Risks — Reviewed, Accepted As-Is

- **AI-disclosure content policy** (Module 2 hardcodes "no AI disclosure in descriptions") — reviewed and accepted; no change needed.
- **Multi-key Gemini ToS risk** (rotating a pool of free-tier keys) — reviewed; not a current concern. May move to a paid Gemini Pro key later, decision deferred until then.

---

## Open Discussions — Not Yet Decided

- **Unsigned Windows exe / SmartScreen.** An unsigned Electron exe triggers a "Windows protected your PC" warning on first run. Not a blocker for personal use (click "More info → Run anyway"), but worth knowing before packaging so it doesn't look broken. Code-signing is a separate, optional later decision if the exe is ever shared beyond personal use.

---

## Future Consideration — Full Midjourney Submission Automation (not planned)

Two separate things get conflated under "automate Midjourney":

1. **Exporting generated images into the dashboard** — safe, covered above (watched-folder auto-import). No ToS exposure, since it never interacts with Midjourney at all.
2. **Auto-submitting prompts to Midjourney itself** (clicking/typing into its Discord bot or web app, whether via a custom script or an AI browser agent like Claude in Chrome or a GPT-based computer-use agent) — this is a materially different thing. As of 2026 there is no official public Midjourney API; the only way to submit prompts programmatically is by automating its Discord/web interface. Midjourney's terms of service prohibit this kind of automation regardless of what drives the clicking — a hand-rolled script and an AI agent clicking the same buttons carry the same account-ban risk, since it's the interface automation itself that violates the terms, not the tool doing it.

**Decision: not building #2.** The safe, ToS-clean piece (folder-watch auto-import) is the one being built. Prompt submission stays manual — the user pastes Module 4's generated prompts into Midjourney themselves. Revisit only if Midjourney ever ships an official public API, or if the user explicitly decides to accept the account-ban risk of an unofficial automation route.
