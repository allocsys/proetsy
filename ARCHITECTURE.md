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

Etsy publishing is manual by design — no auto-uploader module. The app's job ends at producing an approved, ready-to-copy listing (and mockups); the user pastes it into Etsy themselves. Every arrow above the final step is a toggle point. A run can go straight from upload → listing generator → manual copy-paste, skipping mockups entirely (this is Phase 1 / the "quick win").

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
**Tag selection:** pulls from the user's pre-made tag list, matched to image analysis output — not freely generated
**Tech:** Gemini API via the LLM provider layer

### Module 3 — Mockup Composer (optional)
**Input:** artwork file + product type (e.g. "8x10 print", "square canvas")
**Output:** composited mockup image(s), in the shop's defined display order
**Tech:** a single `mockup-generator.js` file. No Canvas/Pillow/Canva API.
- Reads a **config file** mapping product type → mockup template path (e.g. `{ "8x10-portrait": "templates/8x10-frame.png", "square-canvas": "templates/square.png" }`)
- Given `(artworkPath, productType)`, looks up the matching template from config and composites the artwork into it
- New product types/templates are added by editing the config, not the code

### Module 4 — Trend/Prompt Helper (optional, manual-trend version)
**What changed from the original plan:** no live Etsy trend-pulling API call. Trends are a **manually maintained/selected list** (e.g. a `trends.json` or a dropdown in Settings) that the user updates themselves.
**Input:** selected trend + desired category
**Output:** ready-to-paste Midjourney prompts using shop conventions (`--v 7`, `--style raw`, aspect ratio per category, `--s 50–150`)
**Tech:** Gemini API via the LLM provider layer, no Etsy API dependency. (This module only *writes* Midjourney-formatted prompt text — it never calls a Midjourney API.)

### Module 5 — Etsy Uploader
**Removed.** Etsy publishing is manual — the user copies the approved listing text and mockups into Etsy themselves. No Etsy API v3 integration, no OAuth, no bulk-publish. This removes the biggest external-account risk from the whole build (Etsy developer approval, bulk-publish bugs, API changes) and the module entirely.

### Module 6 — Control Dashboard (core, not a pipeline step)
React frontend that:
- Lets the user drag-and-drop artwork
- Shows a **pipeline config panel**: toggle which modules run for this job (mirrors the config default, but overridable per run)
- Previews and allows editing any generated field before publishing
- Supports bulk mode (multiple artworks through the pipeline at once)
- Keeps a listing history log
- Settings panel: default price, delivery text, shop style conventions, tag library, trend list, mockup template config
- Provides an easy **copy-to-clipboard / export** view per listing (title, description, tags, mockup files) so pasting into Etsy manually is fast

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

**Fallback: Claude.** Same interface, disabled by default. Can be turned on in config if the Gemini key pool is exhausted, or for a specific module that needs it, without changing any module code.

**Model choice on the Gemini side:** favor a Flash-tier model for the higher daily/rate-limit headroom; reserve a Pro-tier model only for calls that need stronger reasoning, since Pro's free-tier caps are far tighter.

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
- **Local-first:** entire pipeline (analyzer → generator → mockup composer → review) must run against local storage/local DB before any deployment decision. Deployment target (own VPS, Vercel/Render, etc.) is a separate, later discussion.
- **Database:** same tables as the original plan (listings, images, mockups, tags, settings, prompts), plus a `trends` table (manual entries), a `pipeline_config` table/JSON file, and a `jobs` table (job id, per-module status, error messages, timestamps) to support partial failure handling.
- **LLM keys:** a pool of Gemini API keys (env/config, not hardcoded), plus an optional single Claude key for fallback.

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

---

## Suggested build order

1. **Local skeleton**: React frontend + Node backend running locally, DB schema in place, pipeline config wired up (even if most modules are stubs)
2. **Module 2** (Listing Generator) — core, get this solid first, matches original Phase 1
3. **Module 3** (Mockup Composer with own templates) — no external mockup API needed, so this can move up earlier than the original plan's Phase 2
4. **Module 4** (manual-trend prompt helper) — low complexity now that trend-pulling is removed
5. **Deployment** — separate discussion once the local app works end-to-end

(Etsy Uploader is no longer part of the build — publishing is manual.)

---

## Open Risks — Reviewed, Accepted As-Is

- **AI-disclosure content policy** (Module 2 hardcodes "no AI disclosure in descriptions") — reviewed and accepted; no change needed.
- **Multi-key Gemini ToS risk** (rotating a pool of free-tier keys) — reviewed; not a current concern. May move to a paid Gemini Pro key later, decision deferred until then.
