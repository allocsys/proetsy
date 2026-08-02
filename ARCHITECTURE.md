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
**Status: backend analysis — ✅ done. Automated tests — ✅ done. Dashboard surface — ✅ done.**
Implemented in `backend/lib/image-analyzer/index.js` (`analyzeArtworkForJob`), prompt
building in `prompt.js` (`buildImageAnalysisPrompt`), wired up via
`POST /api/jobs/:id/run/image-analyzer` in `backend/server.js`. Unlike Modules 2/3, this
persists onto `artworks.image_analysis` directly (a single column, keyed by artwork, not
job) rather than a job-scoped table row, since the analysis describes the artwork itself
and a re-run should overwrite it, not accumulate per-job history — same idempotency
principle as the other modules' upserts, just via `UPDATE` instead of
`ON CONFLICT DO UPDATE`. The route treats Module 1 as optional (`required: false` to
`setModuleStatus`), matching the Partial Failure Handling rule below: a failure here
never forces the job's `overall_status` to `'failed'`, so the user can fall back to
`PATCH /api/jobs/:id/manual-notes` and proceed straight to Module 2. A new
`GET /api/artworks/:id` route (added alongside this module, since nothing previously
exposed a single artwork's stored analysis) returns `image_analysis` pre-parsed from its
stored JSON string. Test coverage: unit tests for the prompt builder
(`prompt.test.js`), a persistence/idempotency suite for `analyzeArtworkForJob`
(`index.idempotency.test.js` — persists correctly, re-running overwrites rather than
duplicating, throws without persisting on a malformed model response), and an
integration suite for the HTTP routes (`backend/server.image-analyzer-routes.test.js`,
Supertest against the exported Express `app`) — successful analysis, the
optional-module failure path (job not forced to `'failed'`, manual-notes fallback still
works afterward), re-run idempotency at the route level, and the new artwork-lookup
route (including its 404 case). **Dashboard surface:** `frontend/src/JobArtworkAnalysisReview.jsx`
(mirroring `JobListingReview.jsx`/`JobMockupReview.jsx`'s jobId-in, self-contained-state
shape) — loads the job + its artwork's stored `image_analysis` via the routes above,
lets the user trigger a (re-)run via `POST /api/jobs/:id/run/image-analyzer`, and covers
the optional-module fallback flow (a manual-notes textarea wired to
`PATCH /api/jobs/:id/manual-notes`) for when analysis is skipped or fails. Wired into
`App.jsx` alongside `JobListingReview`/`JobMockupReview` behind the same bare job-ID
input (Module 6 itself is still just a skeleton — see that module's own section).

**Input:** artwork file
**Output:** structured description (subject, style, palette, mood) used by Module 2 and for tag matching
**Tech:** Gemini API (vision, multimodal) via the LLM provider layer
**Can be skipped if:** user wants to hand-write listing angle/keywords instead

### Module 2 — Listing Generator (core, not skippable)
**Status: backend generation — ✅ done. Dashboard review/edit UI — ✅ done. Automated tests — ✅ done.**
Generation lives in `backend/lib/listing-generator/index.js` (`generateListingsForJob`),
convention enforcement in `validate.js` (`enforceConventions`), wired up via
`POST /api/jobs/:id/run/listing-generator`, `GET /api/jobs/:id/listings`, and
`PATCH /api/jobs/:id/listings/:listingId` in `backend/server.js`. The dashboard side is
`frontend/src/JobListingReview.jsx` — one editable card per variation (title, description,
tags, alternate tags), a Save button that PATCHes the edit and re-applies
`enforceConventions()` server-side (so a manual edit can't slip a forbidden title word or
an oversized tag past the shop conventions), a Copy-for-Etsy button, and inline warnings —
wired into `App.jsx` alongside `JobMockupReview` behind the same bare job-ID input (Module
6 itself is still just a skeleton — see that module's own section). Test coverage: unit
tests for prompt-building and convention enforcement (`prompt.test.js`, `validate.test.js`),
an idempotency suite for the generation upsert (`index.idempotency.test.js` — re-running
for a job updates existing rows rather than duplicating, `UNIQUE(job_id, variation)`), and
an integration suite for the three HTTP routes themselves
(`backend/server.listing-routes.test.js`, Supertest against the exported Express `app`) —
generate/list/edit, the required-module failure path, re-run idempotency at the route
level, partial-field PATCH updates, the convention backstop on manual edits, and a
cross-job 404 check.

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
**Status: core + smart-crop — ✅ done. PSD (layered/smart-object) template support — ✅ done.**
Implemented in `backend/lib/mockup-generator.js` (`composeMockup` dispatches to a flat-PNG
or PSD compositing path based on template extension, `generateMockupForJob` for the
DB/job wiring), wired up via `POST /api/jobs/:id/run/mockup-composer` and
`GET /api/jobs/:id/mockups` in `backend/server.js`. Uses `jimp` (pinned `^0.22.x`) +
`smartcrop-jimp` for content-aware cropping (both template kinds), `ag-psd` for PSD layer
decoding, and a pure-JS `pureimage`-backed Canvas2D shim (`backend/lib/psd-canvas.js`) so
`ag-psd` never needs `node-canvas` — see "Template formats" below for the full rationale.
PSD-specific logic (template-kind detection, placement-layer lookup/bounds, paint-order
flattening) lives in `backend/lib/psd-template.js` as pure, unit-tested helpers
(`psd-template.test.js`, `mockup-generator.test.js` — 23 tests, Vitest). This pass also
closes a schema gap: the `product_sizes` table is now populated (upserted from
`product-sizes.json` on each mockup run, keyed on `size_key`) instead of staying empty,
since `mockups.product_size_id`'s FK needs a row to point at, and gained a
`placement_layer` column (with a defensive `ALTER TABLE` migration in `backend/db/init.js`
for existing dev DBs). **AI-outpainting fallback for large aspect-ratio mismatches and the
dashboard side-by-side smart-crop/AI-extended review step are now ✅ done too** — see the
full 8-step build sequence below; all 8 steps are complete. A committed real PSD test
fixture, and integration/idempotency tests for the PSD-specific compositing path itself —
both ✅ done. A synthetic layered PSD (background +
an `artwork` placement layer + a nested `frame group` -> `top border`, generated once via
ag-psd's own `writePsd()` and verified round-tripping through `readPsd()` + the project's
real pureimage canvas shim before committing) is checked into the repo as
`backend/lib/__fixtures__/framed-wall-test.psd.b64` (base64 text, decoded back to the
identical original bytes by `__fixtures__/load-psd-fixture.js` — committed as base64
since this repo's tooling writes plain-text file content, not raw binary). A new
`backend/lib/mockup-generator.psd.test.js` exercises `composeMockup()`/
`generateMockupForJob()` end-to-end against that real fixture: the PSD decode + layer
substitution + full-canvas compositing path, the "placement layer not found" error path
against a real decoded PSD (not a hand-built plain object), and the same
`UNIQUE(job_id, product_size_id)` upsert-not-duplicate idempotency rule
mockup-generator.idempotency.test.js already covers for flat templates, now exercised
specifically against `composeMockupPsd`'s own file-IO.

**AI-outpainting fallback — ✅ done (all 8 steps).** Broken into
independently-committable sub-steps, each testable before the next depends on it:
1. **Verify the current Gemini image-generation model string — ✅ done (research only, no code yet).**
   Findings as of this pass (verify again before actually wiring step 2, since this family
   has been shipping fast):
   - The "Nano Banana" family is now **four models**, not the "2.5/3 Flash Image" guess
     this doc originally had: legacy `gemini-2.5-flash-image` ("Nano Banana" — Google's
     docs now say to migrate off this one), `gemini-3.1-flash-lite-image` ("Nano Banana 2
     Lite" — cheapest/fastest), `gemini-3.1-flash-image` ("Nano Banana 2" — Google's
     recommended default, best speed/quality/cost balance), and `gemini-3-pro-image`
     ("Nano Banana Pro" — highest fidelity, tighter free-tier caps, has a "thinking" step).
     **Decision: pin `gemini-3.1-flash-image` for the outpaint call** (matches the
     `GEMINI_MODELS` cascade's existing Flash-first-Pro-last philosophy) — this is a single
     `options.model`-pinned call per the LLM Provider Layer's existing pin mechanism, not a
     new cascade list, since outpainting has different quality needs than Modules 1/2/4's
     text calls.
   - **Good news for step 2 — no endpoint migration needed.** Google now promotes a new
     **Interactions API** (`POST /v1beta/interactions`, different request/response shape:
     `input`/`output_image` instead of `contents`/`inlineData`) as the go-forward path, but
     the **classic `generateContent` endpoint `gemini.js` already uses still works** with
     all four image models — confirmed against Google's "Generate Content API (Legacy)"
     docs. The only addition needed is `generationConfig.responseModalities: ["IMAGE"]` (or
     `["TEXT", "IMAGE"]`) in the request; the response comes back as the same
     `candidates[0].content.parts[].inlineData` shape `callGenerateContent()` already parses
     for vision input, just now appearing in the output too. So step 2 is additive to
     `gemini.js`, not a rewrite.
   - **Flag, not a step-2 blocker: rate limits are per-project, not per-key.** Google's rate
     limits page states this explicitly. `GEMINI_MODELS`/`GEMINI_API_KEYS` cascade rotation
     (already built, LLM Provider Layer above) assumes a key-rotation benefit that may not
     hold if all pooled keys sit under the same billing project — worth a closer look
     separately, but out of scope for this outpainting sub-step and not re-litigated here.
   - **Free-tier headroom for `gemini-3.1-flash-image` specifically is unverified** — third-
     party sources (not Google's own docs) still cite the old `gemini-2.5-flash-image`
     "~500 images/day" figure this doc already has a caveat on; image models also have their
     own per-minute "images per minute" (IPM) limit separate from token limits. Re-check
     actual free-tier RPD/IPM for `gemini-3.1-flash-image` via the AI Studio rate-limit
     dashboard (not a blog) before step 4 wires this into the real pipeline, since it
     changes how urgent the multi-key pool is for this specific call.
   Blocked step 2 only; step 2 itself is not started.
2. **Add `generateImage()` to the LLM provider layer — ✅ done.** Implemented in
   `backend/lib/llm/gemini.js`: `sendGenerateContentRequest()` factors out the fetch/error
   handling shared with `callGenerateContent()`; `callGenerateImage()` sets
   `generationConfig.responseModalities` and extracts the `inlineData` part instead of text;
   `generateImage(prompt, imagePath, options)` mirrors `generateVision()`'s shape (imagePath
   optional, for pure text-to-image), pins `DEFAULT_IMAGE_MODEL` (`gemini-3.1-flash-image`,
   overridable via `GEMINI_IMAGE_MODEL` — see step 1's model-choice findings) instead of
   walking the text-oriented `GEMINI_MODELS` cascade, but still cascades across the key pool
   for that pinned model, reusing the existing queue/cooldown machinery unchanged. Stubbed in
   `claude.js` for interface symmetry only (always throws — Claude has no comparable
   endpoint); `llm/index.js`'s `generateImage()` deliberately bypasses the `LLM_PROVIDER`
   switch and calls `gemini.js` directly, so it keeps working even when `LLM_PROVIDER=claude`
   is set for text/vision calls. Not yet tested (no test file touched this pass) and not yet
   called from anywhere — that's step 3.
3. **A standalone outpaint-call helper in `mockup-generator.js` — ✅ done.**
   `buildOutpaintPrompt(targetWidth, targetHeight)` is a pure function (unit-testable
   without a real image or network call); `outpaintArtwork(artwork, targetWidth,
   targetHeight)` writes the artwork to a temp file (`generateImage()` takes a path, not a
   Jimp instance), calls `generateImage()`, best-effort cleans up the temp file, and
   returns the result as a Jimp instance. Always throws on failure rather than falling back
   to anything — by design, since step 4 (not this step) owns deciding what "fallback to
   smart-crop" means. **Still not wired into `composeMockup`** — nothing calls
   `outpaintArtwork()` yet, and no test file was added this pass (formal tests are step 8).
4. **Wire it into `composeMockup` for both template paths — ✅ done.** A new shared
   `resolveArtworkForTarget(artwork, targetWidth, targetHeight, mismatch, sizeKey,
   warnings)` holds the mismatch-handling decision itself (below `LARGE_MISMATCH_RATIO`
   → smart-crop; at/above it → try `outpaintArtwork()`, resize its result to exactly
   `targetWidth`x`targetHeight` since the model isn't guaranteed to return exact pixel
   dimensions) and is called from both `composeMockupFlat` (target = template canvas size)
   and `composeMockupPsd` (target = placement-layer bounds) — the decision doesn't depend
   on template kind, only what the target dimensions mean does. On outpaint failure, the
   old `largeMismatchWarning()` (which said the AI fallback "isn't implemented") was
   replaced with `outpaintFailureWarning()`, which names the actual error and notes the
   smart-crop fallback; nothing throws from `resolveArtworkForTarget` itself, so a bad or
   failed AI result never blocks mockup composition — the failure is flagged in
   `warnings` (surfaced the same way any other Module 3 warning already is), not hidden.
5. **Schema + migration — ✅ done.** Added to `backend/db/schema.sql`'s `mockups` table:
   `ai_extended_path` (nullable TEXT — only populated when an outpaint attempt actually
   succeeded), `needs_review` (INTEGER NOT NULL DEFAULT 0), `selected_variant` (TEXT NOT
   NULL DEFAULT `'smart_crop'`). `file_path` is unchanged and keeps holding whichever
   variant is currently selected, so nothing reading `file_path` today needs to change.
   Same defensive-migration pattern as `product_sizes.placement_layer`: three new
   `ALTER TABLE mockups ADD COLUMN ...` lines in `backend/db/init.js`'s `runDefensiveMigrations()`,
   each already wrapped by that function's existing try/catch-on-"duplicate column" logic, so
   no new error handling was needed. **Not yet used anywhere** — nothing in
   `mockup-generator.js` writes these columns yet (step 4's `resolveArtworkForTarget` still
   only produces one final image per run); that's step 6's job.
6. **Persist both variants + a new route — ✅ done.** `generateMockupForJob` writes
   `file_path` and `ai_extended_path` (when outpainting succeeded) as before, plus a new
   `smart_crop_path` column (schema addition beyond the original step-5 scope — see below)
   holding the smart-crop output's path independently of `file_path`, and sets
   `needs_review`. A new `PATCH /api/jobs/:id/mockups/:mockupId/variant` route in
   `backend/server.js` (body `{ variant: 'smart_crop' | 'ai_extended' }`) sets
   `selected_variant`, syncs `file_path` to the chosen variant's stored path, and clears
   `needs_review`.
   **Why `smart_crop_path` was added (not in step 5's original schema):** `file_path` is
   documented as holding "whichever variant is currently selected," which means the route
   overwrites it on every switch. Without a separate durable place for the smart-crop
   path, switching to `ai_extended` and then back to `smart_crop` would have nothing to
   restore `file_path` to — `ai_extended_path` is preserved, but the original smart-crop
   value wasn't, once overwritten. `smart_crop_path` closes that gap; it's always
   populated (`composeMockup()` always produces a smart-crop variant) and never mutated
   after the generation run that created it, so both variants' files remain independently
   recoverable no matter how many times `selected_variant` is toggled.
   **Not yet used anywhere:** no dashboard UI calls this route yet (that's step 7).
7. **Dashboard review UI — ✅ done.** A minimal `JobMockupReview` component
   (`frontend/src/JobMockupReview.jsx`): smart-crop vs AI-extended side by side with a
   select button each when `needs_review` is true, or just the currently-selected variant
   otherwise. Wired minimally into `App.jsx` via a bare job-ID input + "View mockups"
   button (Module 6 itself is still just a skeleton — the rest of it isn't built here, per
   the plan). Selecting a variant calls the step-6 PATCH route and reloads the list.
   **Schema-adjacent addition needed to make this real (not in steps 1–6's original
   scope):** the mockups table only ever stored server-side filesystem paths, with no way
   for the frontend to fetch the actual image bytes. `backend/server.js` now serves
   `OUTPUT_DIR` statically at `/mockup-files` (exported from `mockup-generator.js` for
   this purpose) and both mockup-returning routes (`GET .../mockups`, the step-6 PATCH)
   attach `file_url`/`smart_crop_url`/`ai_extended_url` alongside the raw paths, built from
   each path's basename since `OUTPUT_DIR` is flat (no subdirectories). `frontend/vite.config.js`
   proxies `/mockup-files` to the backend in dev, matching the existing `/api` proxy.
8. **Tests — ✅ done.** Unit tests for the outpaint-trigger logic and prompt-building (the
   pure parts of step 3) in `mockup-generator.test.js`: `shouldAttemptOutpaint` (a pure
   trigger-threshold decision extracted out of `resolveArtworkVariants` in this pass
   specifically so it's testable without real image files or a network call) and
   `buildOutpaintPrompt` (already pure/exported from step 3). Plus an idempotency suite
   for the step-6 upsert in `mockup-generator.idempotency.test.js`, run end-to-end against
   a real temp SQLite DB and tiny synthetic image fixtures with a matching aspect ratio
   (keeps the mismatch under `LARGE_MISMATCH_RATIO` so no Gemini call happens, keeping the
   suite hermetic) — verifies `UNIQUE(job_id, product_size_id)` updates the existing row
   rather than duplicating it, and that a re-run resets `selected_variant` back to
   `'smart_crop'` even if a prior run had been switched to `'ai_extended'`.

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
    "square-canvas":  { "dimensions": "12x12", "dpi": 300, "orientation": "square",   "mockup_template": "templates/square.png" },
    "framed-psd":     { "dimensions": "11x14", "dpi": 300, "orientation": "portrait", "mockup_template": "templates/framed-wall.psd", "placement_layer": "artwork" }
  }
  ```
- Given `(artworkPath, productType)`, looks up the matching entry and composites the artwork into its template
- **This same config is the single source of truth for Module 2** — no separate hardcoded size list. A size only shows up as sellable/mentionable once it has an entry here (dimensions, DPI, and a mockup template).
- New product types/templates/sizes are added by editing this one config, not the code, and not duplicated anywhere else

**Template formats: PNG (flat) and PSD (layered, smart-object-style) — both ✅ done.**
Most purchased/downloaded Etsy mockup packs ship as layered `.psd` files built around a
Photoshop smart object, not a single flat PNG — so real template quality means reading
the PSD's own layer structure rather than requiring the user to pre-flatten every
template by hand. Decided approach (prioritizing fidelity to how these templates are
actually built over implementation effort — a flatten-to-PNG shortcut was considered and
rejected as a quality regression for exactly the templates most likely to be used):
- **Which kind of template a `mockup_template` path is** is inferred from its file
  extension (`.psd` vs `.png`/`.jpg`/etc.) — no separate config flag needed. Implemented as
  `detectTemplateKind()` in `backend/lib/psd-template.js`.
- **Library: `ag-psd`** (pure JS, no native deps — same Termux/Electron-friendly
  constraint used elsewhere, e.g. Module 7's `onnxruntime-web` choice). Reads a PSD's
  layer tree, each layer's pixel bounds, and (where the format exposes it) blend mode/
  opacity.
- **Canvas2D requirement — resolved with a pure-JS shim, not `node-canvas`.** Reading
  layer *pixel data* (not just structure) requires `ag-psd` to have a Canvas2D
  implementation registered via its `initializeCanvas(createCanvas, createImageData)`
  hook; without one it throws rather than silently degrading. `ag-psd`'s own docs point to
  `node-canvas`, but that has native Cairo bindings, which conflicts with this project's
  zero-native-deps/Termux-Electron constraint. Instead, `backend/lib/psd-canvas.js`
  registers a shim backed by **`pureimage`** (pure JS, no native deps): `pureimage.make()`
  returns a `Bitmap` whose `.getContext('2d')` and flat RGBA `.data` buffer satisfy both
  roles `ag-psd` needs (`createCanvas` and `createImageData`) with a direct byte copy, no
  adapter code needed beyond wiring the two functions in. Verified against `ag-psd`'s
  actual decode path, not just the registration call succeeding: a synthetic layered PSD
  written via `ag-psd`'s own `writePsd`, then read back via `readPsd` through this shim,
  round-trips layer pixel data correctly.
- **Placement is layer-based, not whole-canvas.** `product-sizes.json` gains an optional
  `placement_layer` field (see `framed-psd` example above) naming the PSD layer whose
  bounds mark where the artwork goes — defaults to `"artwork"` if the field is omitted
  (`DEFAULT_PLACEMENT_LAYER` in `psd-template.js`). This replaces the PNG convention's
  "transparent window" for PSD templates specifically: the artwork is smart-cropped/
  resized to *that layer's* pixel bounds (not the full document canvas), then every
  visible PSD layer is rendered in its original stacking order onto a canvas the size of
  the full document, substituting the artwork bitmap in for the placement layer's own
  pixel data. Layer/group `hidden` flags and per-layer `opacity` are respected during this
  render (a hidden group hides its children regardless of their own `hidden` flag);
  blend modes beyond default source-over are not re-implemented — see the known limitation
  below. Aspect-ratio mismatch handling (above) is unchanged in principle —
  `targetWidth`/`targetHeight` for the smart-crop step just come from the placement
  layer's bounds instead of the template's overall canvas size. The placement layer is
  found via a recursive, case-sensitive search (`findPlacementLayer()`) so it can sit
  inside nested layer groups, not just at the document's top level.
- **Known, accepted limitation — flag prominently rather than silently degrade quality:**
  `ag-psd` reads pixel data and layer bounds/effect descriptors; it does not re-evaluate
  Photoshop smart-object warp/perspective transforms or fully re-render most layer
  effects (drop shadows, overlays, etc.) the way Photoshop itself would. A common
  commercial-mockup-pack pattern — a smart object perspective-warped to sit at an angle
  inside a photographed frame — will place the artwork as an unwarped, axis-aligned
  rectangle within the placement layer's bounding box, not warped to match the frame's
  angle. Every new PSD template should be spot-checked after its first mockup run for
  exactly this reason. A follow-on option (out of scope for this pass): read the smart
  object's warp-transform matrix out of the PSD's descriptor data and apply a matching
  affine/perspective transform to the artwork before compositing — real additional work,
  worth doing if warped-smart-object templates turn out to be the common case rather than
  the exception, not before.
- Flat PNG/JPEG templates are unaffected — they keep using the existing "template canvas
  = full output, transparent window" convention described above; PSD support is additive,
  not a replacement.

### Module 4 — Trend/Prompt Helper (optional, manual-trend version)
**Status: backend generation — ✅ done. Dashboard surface — ✅ done. Automated tests — ✅ done.**
**What changed from the original plan:** no live Etsy trend-pulling API call. Module 4 calls the **trends provider layer** (see below), currently backed by a manually maintained/selected list (a dashboard-entered/browsed list via the `trends` table, not a static `trends.json`) that the user updates themselves.
**Input:** selected trend + desired category
**Output:** ready-to-paste Midjourney prompts using shop conventions (`--v 7`, `--style raw`, aspect ratio per category, `--s 50–150`)
**Tech:** Gemini API via the LLM provider layer, no Etsy API dependency. (This module only *writes* Midjourney-formatted prompt text — it never calls a Midjourney API.)

Generation lives in `backend/lib/prompt-helper/index.js` (`generatePromptsForTrend` +
`listPrompts`), prompt building in `prompt.js` (`buildPromptHelperPrompt`), convention
enforcement in `validate.js` (`enforceMidjourneyConventions` — the `--v 7`/`--style
raw`/`--ar`/`--s` backstop, mirroring `listing-generator/validate.js`'s pattern), and the
new Midjourney conventions themselves in `backend/config/shop-conventions.js`
(`MIDJOURNEY_CONVENTIONS`). Wired up via `POST /api/prompts/generate`, `GET
/api/prompts`, plus `GET /api/trends` and `POST /api/trends` (single-entry manual trend
creation) plus `POST /api/trends/csv` (CSV import via `trends/manual.js`'s existing
`importFromCsvRows`) in `backend/server.js`. **Deliberately NOT job-scoped**, per this module's
isolation from the main pipeline (see Partial Failure Handling): no `job_modules` row, no
`jobId` parameter anywhere in its code path — a generation run is keyed only by an
optional `trend_id` + a target `category`. Each call **inserts a new batch of `prompts`
rows rather than upserting one row per (trend, category)** — unlike listings/mockups,
the point is a browsable history of generated batches, not one current value per key, so
re-running with the same trend/category is expected behavior, not a duplicate to guard
against. Also implements Module 7's optional prompt-feedback link on the read side (see
Module 7 -> "Prompt-feedback link to Module 4"): pulls up to 5 terms from `prompt_terms`
where `kept_count > discarded_count`, ordered by that gap, and includes them in the LLM
prompt as a non-overriding style hint — naturally empty (and so a no-op) until Module 7
exists and has real labeled data, rather than a separate feature flag. **Dashboard
surface:** `frontend/src/PromptHelper.jsx` (not job-scoped, so it doesn't take a `jobId`
prop the way `JobListingReview`/`JobMockupReview`/`JobArtworkAnalysisReview` do) —
category selector, a trend picker sourced from `GET /api/trends` plus an inline
add-a-trend form, a Generate button, copy-to-clipboard on each result, and a
category-filtered history list. Wired into `App.jsx` outside the job-scoped block, always
visible regardless of whether a job ID has been entered. Test coverage: unit tests for
the prompt builder (`prompt-helper/prompt.test.js`) and the conventions backstop
(`prompt-helper/validate.test.js`), a persistence suite covering the append-not-upsert
batch semantics, trend association, the not-found-trend error path, and the style-hints
link (`prompt-helper/index.test.js`), and a route-level Supertest suite
(`backend/server.prompt-routes.test.js`) for all four new endpoints.

### Module 7 — Taste Filter (Curation) (optional, pre-pipeline)
**Status: embeddings, centroids, scoring, routes, dashboard UI, the Module 4 prompt-feedback write side, and auto-import via watched folder — ✅ all done (see "Build sequence" below). Module 7's full build sequence is complete.**
**What it does:** Ranks a batch of raw Midjourney-generated candidates against a learned taste profile, so obvious "slop" gets flagged before it ever becomes a listing candidate.
**Input:** a batch of candidate images (generated manually in Midjourney, dragged into the dashboard)
**Output:** each candidate gets **two taste scores** — a global score and a per-category score — plus a suggested label (likely-keep / likely-discard / uncertain). Nothing is auto-deleted — the user confirms keep/discard, and that confirmation is the training signal.
**Tech:** local image embeddings via a **JS-only CLIP implementation** — `onnxruntime-web` (WASM execution provider) running the pre-converted **`Xenova/clip-vit-base-patch32`** ONNX model (OpenAI CLIP, already exported for JS runtimes, MIT-licensed — no conversion work needed), called directly from the Node backend (not a child process, not a separate Python script). No API key, no per-request cost, no network dependency, and no second runtime to manage — everything (backend, frontend, embeddings) stays in one Node process.

**Build sequence.** Broken into independently-committable sub-steps, mirroring Module 3's AI-outpainting build log above:
1. **Embeddings helper — ✅ done.** `backend/lib/taste-filter/embeddings.js`: a pure `preprocessImage()` (resize/center-crop to 224x224, RGB channel split, CLIP mean/std normalization — unit-testable without a real model or network call), `l2Normalize()`, and `embedImage(imagePath)`, which loads `Xenova/clip-vit-base-patch32` via `onnxruntime-web` (WASM) and returns an L2-normalized embedding vector. Adds `onnxruntime-web` to `backend/package.json`. The `.onnx` weights file itself is a large binary and isn't committed to the repo — resolved via a configurable model path (`TASTE_FILTER_MODEL_PATH`, same pattern as `MOCKUP_TEMPLATES_DIR`), with a clear startup/first-run error if it's missing, not a silent failure. Tested in `embeddings.test.js`.
2. **Persistence + centroid math — ✅ done.** `backend/lib/taste-filter/centroids.js`: pure functions (`computeCentroid`, `computeCentroidPair`, `computeAllCentroidPairs`) computing a kept/discarded centroid pair from a set of labeled embeddings, both global and per-category — no DB, no model, unit-tested against synthetic vectors (`centroids.test.js`). `backend/lib/taste-filter/store.js`: the DB-touching glue around it — `addImagePreference()` (always inserts, never upserts — a full label history like `prompts`, not one row per image), `listImagePreferences()`, `recomputeCentroids()` (reads the full `image_preferences` history, calls `computeAllCentroidPairs()`, persists every category's pair to `taste_centroids` in one transaction), and `getCentroids(category)`. Embeddings/centroids round-trip through the BLOB columns via `Float32Array`<->`Buffer` helpers. **Spec deviation worth flagging:** `taste_centroids.category` has no `UNIQUE` constraint in `schema.sql`, and a `UNIQUE` constraint wouldn't have been sufficient anyway since SQLite treats every `NULL` as distinct — which would break upserting exactly the row this needs most (the global pair, stored as `category IS NULL`). `recomputeCentroids()` does a NULL-safe select-then-update-or-insert instead of a SQL-level `ON CONFLICT` upsert, wrapped in one transaction. Tested end-to-end against a real temp SQLite DB (`store.test.js`), including the cold-start case (`getCentroids()` on an unlabeled category returns nulls, not an error) and re-recompute idempotency (updates existing `taste_centroids` rows, doesn't duplicate them).
3. **Scoring — ✅ done.** `backend/lib/taste-filter/scoring.js`: pure functions — `cosineSimilarity()`, `scoreAgainstCentroids()` (kept-similarity minus discarded-similarity; `null` only when neither centroid exists yet), `labelFromScore()` (likely-keep/likely-discard/uncertain, using a small band around zero for genuine ambiguity — never auto-discards), `isConfident()` (cold-start gate, `COLD_START_MIN_EXAMPLES = 30` combined kept+discarded examples), and `scoreCandidate()` (the full per-candidate result: global + optional category score/label/confidence in one call). No DB, no model — unit-tested against synthetic vectors (`scoring.test.js`).
4. **Routes — ✅ done.** `POST /api/taste-filter/import` (multipart `files` + optional `category`/`prompt_id` — saves each file to `CANDIDATES_DIR`, embeds it, scores it against the current global/category centroids, and returns the scored batch; a per-file embed failure doesn't fail the rest of the batch), `POST /api/taste-filter/label` (body: `image_path`, `embedding` array, `label`, optional `category`/`prompt_id` — persists via `addImagePreference()` then synchronously calls `recomputeCentroids()`), `GET /api/taste-filter/centroids` (coverage counts per category, for cold-start messaging), and `POST /api/taste-filter/recompute` ("Recompute now"). Deliberately **no "pending candidates" table**: an imported-but-not-yet-labeled batch lives only on disk (`CANDIDATES_DIR`, served at `/taste-filter-files`) plus the import response's embedding — nothing is written to `image_preferences` until the user actually labels it, matching "nothing is auto-deleted [...] the user confirms keep/discard, and that confirmation is the training signal." Tested in `backend/server.taste-filter-routes.test.js` (embedImage mocked — the real ONNX model isn't available in CI, same reasoning as Module 1's `generateVision` mock): batch import + per-file scoring, a partial-batch embed failure not failing the whole import, labeling + centroid recompute reflected via `GET /centroids`, a subsequent import scoring against the now-real centroids instead of null, and the invalid-label/missing-embedding 400 paths.
5. **Dashboard UI — ✅ done.** `frontend/src/TasteFilter.jsx` (not job-scoped, mirrors `PromptHelper.jsx`'s shape) — category + optional prompt-ID fields, a drag-and-drop batch importer, a ranked grid showing each candidate's image plus global/category score badges (color-coded by suggested label, flagged when still cold-start), Keep/Discard buttons per candidate (removes it from the grid and posts the label), and a "Recompute now" button. Wired into `App.jsx` below `PromptHelper`, always visible. Candidates and their embeddings live only in this component's local state until labeled — nothing is fetched back from a server-side "pending" list on reload, since none exists (see step 4).
6. **Prompt-feedback link to Module 4 (write side) — ✅ done.** `backend/lib/taste-filter/prompt-terms.js`: a pure `extractPromptTerms(promptText)` — splits a Midjourney-formatted prompt into a deduplicated, lowercased set of content terms, stripping known MJ parameter flags (`--v`, `--style`, `--ar`, `--s`, etc.) and their argument tokens plus a small stopword list and bare numbers, so values like "7" or "raw" from `--style raw` never get tallied as if they were style words. `backend/lib/taste-filter/store.js`'s new `tallyPromptTermsForLabel(promptId, label)` is the DB-touching half: looks up the labeled candidate's originating prompt (via `prompt_id`), extracts its terms, and upserts each into `prompt_terms.kept_count`/`discarded_count` (`ON CONFLICT(term) DO UPDATE ... = ... + 1`) — the same counts Module 4's `getStyleHints()` already reads back as "terms that have worked well." No-op (not an error) when `promptId` is null or doesn't resolve to a real prompt, so a missing/unlinked prompt never blocks the label itself from saving — matches the doc's "secondary and opt-in" framing. Wired into `POST /api/taste-filter/label` in `backend/server.js`, called right after `recomputeCentroids()`. Tested in `prompt-terms.test.js` (pure extraction: flag/argument stripping, stopwords, bare numbers, dedup, unrecognized-flag handling, empty input), `store.test.js` (kept vs. discarded tallying, repeated-call accumulation, the promptId no-op cases, and an end-to-end check that the tallied terms are exactly what `getStyleHints()`'s query would surface), and two new cases in `server.taste-filter-routes.test.js` (the full label-route → `prompt_terms` path, and confirming a label with no `prompt_id` still succeeds without touching `prompt_terms`).
7. **Auto-import via watched folder — ✅ done.** `backend/lib/taste-filter/watcher.js`: a `chokidar` watcher, started/stopped by `syncWatcherFromSettings(candidatesDir)` against three new settings-table keys (`taste_filter_watch_enabled`, `taste_filter_watch_folder`, `taste_filter_watch_category` — read/written through the existing generic `GET`/`PATCH /api/settings` routes, no dedicated table), called once on backend startup (so a restart picks a previously-saved folder back up) and again after every `PATCH /api/settings` (so toggling the checkbox or editing the folder path takes effect immediately, no restart needed — a settings change touching neither key is a no-op for an already-running watcher). On a chokidar `add` event for an image file (`depth: 0` — a flat drop folder, not a tree to recurse; `awaitWriteFinish` so a still-downloading file isn't read mid-write), the file is copied into `CANDIDATES_DIR` (the same place a manual drag-and-drop import already saves to) under a fresh generated filename, embedded and scored against the current global/category centroids exactly like `POST /api/taste-filter/import` does, and held in an in-process `Map` — **deliberately no DB table for this queue either**, mirroring step 4's "no separate pending candidates table" decision: nothing is written to `image_preferences` until the user actually labels it. Unlike the manual path's queue (which lives only in the frontend's local state, since a real HTTP response is there to hold it), this queue has no request to attach to — nothing in the browser triggered it — so the equivalent is `getPendingCandidates()`/`removePendingCandidate()`, backing two new routes: `GET /api/taste-filter/pending` (polled by the dashboard; same `{ candidates }` shape `POST /import` already returns, so `TasteFilter.jsx` merges both sources into one local list without a separate code path) and `GET /api/taste-filter/watch-status` (read-only: active/folder/category/pending count/last error, for the Settings panel). `POST /api/taste-filter/label` now also calls `removePendingCandidate(image_path)` right after recomputing centroids, so a labeled watcher-detected candidate doesn't get re-surfaced on the next poll — a no-op for a manually drag-and-dropped candidate, which was never in this queue. **Activation, per the section below:** a Settings-panel toggle (`frontend/src/App.jsx`) — a checkbox, a folder-path text field, and an optional category field, all backed by the existing settings key/value store, plus a read-only status line sourced from `GET /api/taste-filter/watch-status`. Off by default. Tested in `backend/lib/taste-filter/watcher.test.js` (start/stop conditions, a real chokidar watch against a temp folder with `embedImage` mocked, non-image files ignored, folder-switch restart, missing-folder error) and two new cases in `backend/server.taste-filter-routes.test.js` (`GET /pending`/`GET /watch-status` default state, and an end-to-end PATCH-settings → drop-a-file → poll → label → cleared-from-queue flow against the real routes).
8. **Tests — ✅ done, ongoing alongside each step above**, not a separate final pass (matches how Module 3's step 8 only covered what wasn't already tested inline).

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

**Auto-import via watched folder — ✅ built (see "Build sequence" step 7 above).**
Once Midjourney generates and downloads images to a local folder, a lightweight file-watcher (`backend/lib/taste-filter/watcher.js`, `chokidar`) detects new files and automatically pulls them into Module 7's queue — no manual drag-and-drop needed for the *import* step. This is pure local file-system watching, no API call, no network dependency, no Midjourney ToS exposure at all, since it never touches Midjourney's systems.

**Activation: a toggle in the dashboard Settings panel** ("Auto-import from folder" checkbox + a folder-path field + an optional category field), not always-on by default. Off by default keeps behavior predictable; the user turns it on once they've set the watched folder path.

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
**Status: upload + bulk mode + pipeline override panel + settings/tag-library panel + job history log (now with grouped bulk-batch rows) + server-side job runner + CSV tag import + trend-list/shop-conventions settings consolidation — ✅ done.**
Implemented directly in `frontend/src/App.jsx` (no longer just the bare job-ID-input
skeleton the earlier pass left behind), against three new/changed backend routes in
`backend/server.js`: `POST /api/artworks/upload` (multer, disk storage under
`backend/data/uploads/`, accepts one-or-many files under a `files` field — a single drop
and a bulk drop are the same request shape), `GET`/`PATCH /api/settings` (generic
key/value store backed by the existing `settings` table), and `GET /api/tags` +
`POST /api/tags/bulk` (paste-a-list tag-library import, dedupes against existing tag
text). `POST /api/jobs` now accepts an optional `pipeline_overrides` object, threaded
through to `createJob()` in `backend/lib/jobs.js` — a required module (Module 2) can't be
overridden off. A new `GET /api/setup-status` route (Gemini key presence via
`GEMINI_API_KEYS`, tag-library/product-size counts) backs the dashboard's persistent
setup-status banner per the First-Run Setup section below.

- **Drag-and-drop + bulk artwork upload — ✅ done.** A drop zone (plus a plain file input
  fallback) posts to the new upload route, creates one `artworks` row per file, then
  creates a job per artwork and runs its full pipeline via the server-side runner below —
  each job proceeds independently, so one artwork's failure doesn't block the rest of a
  bulk batch, matching Partial Failure Handling's bulk-mode rule.
- **Server-side job runner — ✅ done.** `backend/lib/pipeline-runner.js`
  (`runPendingModulesForJob`, `runPendingModulesForJobs`) runs every currently pending/
  retryable module for a job, in pipeline order, from a single call — wired up via
  `POST /api/jobs/:id/run` (one job) and `POST /api/jobs/run-batch` (body `{ job_ids }`,
  the bulk-mode counterpart, each job still proceeding independently) in `backend/server.js`.
  Unlike the earlier client-side sequencing this replaces, the run isn't tied to the
  browser tab staying open — once the request lands, the async chain keeps going
  server-side even if the tab that triggered it closes; already-completed modules and
  their DB rows are unaffected either way, and any module can still be retried
  individually via the existing per-module `/run/<module>` routes. `App.jsx`'s upload flow
  now calls `POST /api/jobs/run-batch` instead of sequencing module calls itself. Tested
  in `backend/server.pipeline-runner-routes.test.js`.
- **Pipeline config panel (per-run override) — ✅ done.** Checkboxes seeded from
  `GET /api/config/pipeline`'s defaults; toggling one only affects artwork uploaded next
  in the same browser session, never rewrites `pipeline.config.json` on disk, per Step
  control model's "UI override" layer. The required module is shown checked and disabled.
- **Listing/job history log — ✅ done.** A table sourced from the existing `GET /api/jobs`
  route (job id, artwork filename, `overall_status` badge, last-updated timestamp, a
  Review button that loads that job into the review section below).
- **Settings panel — ✅ done.** Tag-library paste-and-save (textarea →
  `POST /api/tags/bulk`), CSV tag import (`POST /api/tags/csv`, backed by
  `tags/user-list.js`'s `tagRowsFromCsvText`/`importTagsFromCsvRows` — mirrors
  `trends/manual.js`'s existing `importFromCsvRows` shape and dedupes against the
  existing library the same way `POST /api/tags/bulk` already does), and default price /
  delivery text (→ `PATCH /api/settings`) are wired. Trend-list management is
  consolidated here too — a read-only list plus an add-a-trend form calling the same
  `GET`/`POST /api/trends` routes Module 4's own `PromptHelper.jsx` already uses (that
  component keeps its own trend picker/add-form too; this is an additional view, not a
  replacement). Shop conventions (title separator, max lengths, tags-per-listing,
  forbidden words, Midjourney `--v`/`--style`/stylize range) are shown read-only via the
  new `GET /api/config/shop-conventions` route — read-only because these are
  intentionally hardcoded (see Module 2 -> "Must hardcode shop conventions"), not
  dashboard-editable config. Product-sizes are shown read-only (still
  config-file-edited, not dashboard-CRUD, since `product-sizes.json`/DB round-tripping
  is a bigger change than this pass's scope).
- **Previews/edits generated fields, and copy-to-clipboard/export** — already covered by
  the existing `JobListingReview.jsx` (Copy-for-Etsy button, inline edit) and
  `JobMockupReview.jsx`, wired into the dashboard's "Review a specific job" section; no
  change needed here.
- **Consolidated single-page "bulk batch" view — ✅ done.** A multi-file drop is given a
  shared `batch_id` (a client-generated UUID, set on every job created from that same
  drop) instead of relying on upload-time proximity to associate them. `jobs.batch_id`
  (nullable — null for a single-artwork upload, which stays ungrouped) is set via an
  optional `batch_id` field on `POST /api/jobs`, generated in `App.jsx`'s `handleFiles()`
  only when more than one file is dropped. The history table's `groupedJobs` memo groups
  jobs sharing a `batch_id` into one collapsible row (item count, a per-status badge
  breakdown, most-recent-updated timestamp) while preserving `GET /api/jobs`'s
  newest-first ordering; expanding it shows the same per-job rows a single upload would,
  each still with its own Review button. Tested in `server.core-routes.test.js`.

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
- **CSV import in `manual.js`.** The user still checks a tool like eRank or EverBee's free tier themselves, but instead of hand-typing findings into `trends.json`, they export that tool's own list as CSV and import it via a button in the dashboard. Same manual, ToS-clean entry point as before — the tool's own export feature, not automation against its interface — just less tedious. **Dedup scope, fixed:** `importFromCsvRows` dedupes a term only against what was already in the `trends` table *before* the call — a term repeated within the same import batch (a literal duplicate row in one CSV export) is inserted once per occurrence, not silently collapsed. An earlier version updated its in-memory dedup set as rows were inserted within the same call, which made a batch's own duplicate rows look pre-existing and under-inserted them; fixed by snapshotting existing terms once, up front, and never mutating that snapshot during the loop.

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

**Status: key x model cascade — ✅ done; request spacing/cooldown/escalation hardening — ✅ done.** Implemented in `backend/lib/llm/gemini.js` (cascade wiring), `backend/lib/llm/rate-limits.js` (cooldown Map + DB persistence), and `backend/lib/llm/queue.js` (per-key spacing + global concurrency cap); backing table added to `backend/db/schema.sql`; new env vars in `backend/.env.example`. Not yet built: the Claude fallback path (`claude.js` is a stub) and a dashboard surface for rate-limit/cooldown status.

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

**Request spacing, concurrency limits & jitter (proactive — before any 429 even happens).** Cooldown tracking and cooldown escalation (below) are both *reactive*: they only kick in after a key has already been hit with a 429. Without something proactive too, **bulk mode** is the obvious way to trigger that in the first place — each artwork in a bulk batch is its own job (see Partial Failure Handling), and each job can call Module 1/2/4 independently, so an unthrottled bulk run could fire a dozen simultaneous requests at once. A burst like that is both more likely to trip Gemini's per-minute limits and, independent of the limits, is exactly the kind of bursty, all-at-once traffic pattern that reads as automated/scripted rather than a person clicking through a dashboard — worth avoiding on its own terms, not just to dodge 429s.

- **At most one in-flight request per key at a time.** Every call to a given key goes through a small per-key queue — if that key already has a request in flight, the next one waits rather than firing in parallel, regardless of how many jobs are asking for it concurrently.
- **Minimum spacing between consecutive requests on the same key**, plus jitter: `LLM_MIN_REQUEST_INTERVAL_MS` (e.g. 1000ms) as a floor, with a randomized `LLM_REQUEST_JITTER_MS` (e.g. up to +400ms) added on top so requests land at slightly irregular intervals rather than a perfectly even drumbeat — mirroring how a human clicking through a dashboard one job at a time would naturally space things out, not a script firing on a fixed timer.
- **A global concurrency cap across the whole pool** (`LLM_MAX_CONCURRENT_REQUESTS`, e.g. 2–3), independent of key count — so a bulk batch spread across several keys still doesn't fire everything at once just because there are enough keys to cover it. Requests beyond the cap queue up and get released as slots free.
- **This queue sits in front of the cooldown cache, not instead of it.** For a given attempt: the cascade first checks the cooldown cache (skip pairs already known to be limited, no call at all), then the surviving candidate acquires a queue slot (waits its turn for that key + the global cap) before the actual request goes out.
- Bulk mode's own job-level behavior (each artwork's job proceeds independently, one job's failure doesn't block others — see Partial Failure Handling) is unchanged; this queue only paces the underlying LLM calls those jobs make, it doesn't serialize the jobs themselves into one-at-a-time processing.

**Rate-limit cooldown tracking (checked before every attempt, not just reacted to after).** Once a `(key, model)` pair 429s, the cascade shouldn't have to rediscover that by hitting it again on the next call — it should already know to skip it:

- A **local, in-process cache** (a `Map`, keyed by `${keyIndex}:${model}` → `{ limitedUntil }`) sits in front of every cascade attempt. Before calling a `(key, model)` pair, the cascade checks this cache first; if it's still in its cooldown window, that pair is skipped with **no network call at all**, and the loop moves straight to the next model/key.
- **Not Redis.** "Something like Redis but local" is deliberately implemented as an **in-process `Map`, not an actual Redis server** — running a separate Redis process would mean a second service to install/manage/keep alive, which conflicts with the same local-first, single-process, no-second-runtime reasoning already used to reject a Python subprocess for Module 7's embeddings (see Module 7 → "Why WASM over native"). A `Map` gives the same fast key→cooldown lookup Redis would, with zero extra moving parts.
- **Backed by SQLite for durability, not just memory.** An in-memory-only cache would forget every cooldown on every restart (`--watch` reload, crash, machine reboot) — fine for short per-minute rate limits, but Gemini free tier also has **per-day** quotas, and a restart shouldn't reset a key's daily exhaustion back to "looks fine, try it." So every cooldown write also persists to a new `llm_rate_limits` table (see Database Schema), and the in-memory `Map` is rehydrated from that table on backend startup. The `Map` is the hot-path read (called on every LLM request); SQLite is the source of truth that survives restarts.
- **Identified by key index, not the raw key.** Rows are keyed by the key's position in `GEMINI_API_KEYS` (`key_index`) plus `model`, never the literal API key string — the key pool is loaded from `.env` in a fixed order at startup, so a positional index is enough to identify "which key" without writing a second copy of the secret into the local DB.
- **Cooldown duration:** if Gemini's error response includes retry-delay info (a `Retry-After` header, or `retryInfo.retryDelay` in the error body), that value sets the cooldown. If neither is present, fall back to a configurable default (`LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS`, e.g. 60s) — conservative rather than guessing an unknown reset time.
- **If every (key, model) pair the cascade would try is already in cooldown**, the call fails fast with a distinct message ("all keys/models currently in rate-limit cooldown, next available at ~T") rather than the generic exhaustion message — useful for telling "we tried and all failed" apart from "we didn't even need to try."

**Backoff means backing OFF, not retrying harder.** Repeatedly re-hitting a key that's already rate-limited — even spaced out with delays — is the kind of bursty, pattern-y traffic that risks a key getting flagged for abuse on Google's side. So there is deliberately **no sweep-level retry loop**: if a cascade sweep ends with every `(key, model)` pair either 429'ing live or already in cooldown, the call **fails immediately** with a clear "all keys/models currently rate-limited" error — no re-attempting, no waiting-and-trying-again within the same request. The caller (a job's module run) surfaces that failure and can be retried later by the user, same as any other module failure (see Partial Failure Handling) — but that's a deliberate, user-initiated retry, not the provider layer quietly hammering the pool again on its own.

**Cooldown escalation instead.** The actual "back off" behavior lives in how long a pair stays avoided, not in how often it gets retried: if a `(key, model)` pair 429s again before its *previous* cooldown has fully elapsed (i.e. it's still recovering and got hit again), the next cooldown is lengthened rather than reset to the same default — e.g. doubling each consecutive hit, capped at a sane ceiling (`LLM_RATE_LIMIT_MAX_COOLDOWN_MS`, e.g. 30 min). A key/model that keeps getting limited gets progressively left alone longer, rather than being probed at a fixed interval indefinitely. This escalation resets once a call to that pair actually succeeds.

**Structured output.** Calls that need reliable JSON back (e.g. Module 2's 3-variation listing response) pass `{ json: true }` in `options`, which sets Gemini's `generationConfig.responseMimeType = 'application/json'` — this is enforced by the API itself, not just requested via prompt wording, so parsing doesn't depend on the model reliably following instructions. The prompt still spells out the exact shape as a second layer of guidance.

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
- **Database:** same tables as the original plan (listings, images, mockups, tags, settings, prompts), plus a `trends` table (manual entries), a `pipeline_config` table/JSON file, a `jobs` table (job id, per-module status, error messages, timestamps) to support partial failure handling, a `product_sizes` table/config (dimensions, DPI, mockup template per size — shared by Modules 2 and 3), an `image_preferences` table (image reference, embedding vector, keep/discard label, category, prompt reference, timestamp) for Module 7's taste model, a `prompt_terms` table (term, kept count, discarded count) for the optional Module 7 → Module 4 prompt-feedback link, and an `llm_rate_limits` table (key index, model, cooldown expiry) as the durable backing store for the LLM provider layer's rate-limit cooldown cache.
- **Local embedding model:** `onnxruntime-web` (WASM) running `Xenova/clip-vit-base-patch32`, for Module 7. JS-only — no Python runtime, no API key, no cost, no network call. Runs in-process within the Node backend, not a separate child process. WASM (not the native `onnxruntime-node` binary) so the same code runs unmodified on Termux/Android and packages cleanly into Electron later without a native-module rebuild step.
- **LLM keys:** a pool of Gemini API keys (env/config, not hardcoded), plus an optional single Claude key for fallback.
- **Provider layers:** three swappable interfaces built in v1 — `lib/llm/`, `lib/trends/`, `lib/tags/` — each with a config-selected implementation, so any of the three can be flipped later without touching module code.

---

## Database Schema

SQLite (matches the local-first, local-DB decision above). `pipeline_config` and backups stay as JSON/files, not tables.

**Core pipeline**
- `artworks` — id, file_path, original_filename, image_analysis (JSON from Module 1), uploaded_at
- `jobs` — id, artwork_id (FK), overall_status, manual_notes (Module 2's fallback input when Module 1 is skipped or fails), batch_id (nullable — a client-generated UUID shared by every job created from the same multi-file drop, so the dashboard history view can group them into one row; null for a single-artwork upload; see Module 6 -> "consolidated single-page 'bulk batch' view"), created_at, updated_at. Indexed on `batch_id`.
- `job_modules` — id, job_id (FK), module_name, status (pending/running/success/failed/skipped), error_message, retry_count, started_at, completed_at. **`UNIQUE(job_id, module_name)`** — re-running a module updates this row rather than inserting a second one, which is what makes the idempotency rule in Partial Failure Handling actually hold at the DB level.
- `listings` — id, job_id (FK), variation (fine_art/aesthetic/gift), title, description, tags (JSON array of 13), tag_alternates (JSON array of 5), edited_at. `UNIQUE(job_id, variation)` for the same idempotency reason.
- `mockups` — id, job_id (FK), product_size_id (FK), file_path, status, ai_extended_path (nullable — only set when an outpaint attempt succeeded, see Module 3 -> "AI-outpainting fallback" step 5), smart_crop_path (always set — the smart-crop output's own path, kept independent of `file_path` so the step-6 PATCH variant route can restore it after a switch to `ai_extended`), needs_review (0/1 — set when both a smart-crop and AI-extended variant exist and no choice has been made yet), selected_variant (`smart_crop` | `ai_extended`, defaults to `smart_crop`). `UNIQUE(job_id, product_size_id)` — re-running Module 3 for a size replaces the file reference, not a duplicate row. **✅ implemented and written** (`backend/db/schema.sql` + defensive `ALTER TABLE` in `backend/db/init.js`; populated by `generateMockupForJob` in `backend/lib/mockup-generator.js`, and `selected_variant`/`file_path`/`needs_review` updated by the step-6 `PATCH /api/jobs/:id/mockups/:mockupId/variant` route in `backend/server.js`).

**Config-as-data**
- `product_sizes` — id, size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer (nullable — only meaningful for `.psd` templates; names the layer whose bounds the artwork is placed into, see Module 3 -> "Template formats") (shared source of truth for Modules 2 & 3). **✅ implemented** (`backend/db/schema.sql`, plus a defensive `ALTER TABLE` in `backend/db/init.js` so pre-existing dev DBs pick up the column).
- `tags` — id, tag_text, category, source (the tag library Module 2 matches against)
- `settings` — key, value (default price, delivery text, shop conventions)

**LLM provider layer**
- `llm_rate_limits` — key_index, model, limited_until, consecutive_hits (used to escalate the next cooldown length — doubles per consecutive 429, resets to 0 on a successful call), reason (nullable — e.g. raw status/error text for debugging), updated_at. `UNIQUE(key_index, model)`. Durable backing store for the in-process cooldown cache described in LLM Provider Layer → "Rate-limit cooldown tracking" / "Cooldown escalation" — rehydrated into memory on backend startup, written to on every 429 and cleared on success. **✅ implemented** (`backend/db/schema.sql`, rehydrated via `backend/lib/llm/rate-limits.js`).

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
2. **Module 2** (Listing Generator) — core, get this solid first, matches original Phase 1. **✅ done:** generation (`backend/lib/listing-generator/index.js`), shop-convention enforcement (`validate.js`), tags-provider integration, the LLM provider layer's key×model cascade plus request-spacing/cooldown/escalation hardening (see LLM Provider Layer status note above), a dashboard review/edit UI (`JobListingReview.jsx`), and automated tests (unit, idempotency, and route-level integration — see Module 2 status note above).
3. **Module 3** (Mockup Composer with own templates) — no external mockup API needed, so this can move up earlier than the original plan's Phase 2. **✅ core + smart-crop + PSD template support + AI-outpainting fallback + dashboard review UI done** (see Module 3 status note above). **This is now done too** (see Module 3 status note above for the committed fixture and PSD-specific idempotency suite).
4. **Module 4** (manual-trend prompt helper) — ✅ done (see Module 4 status note above)
4a. **Module 7** (Taste Filter, pre-pipeline curation gate) — ✅ full build sequence done: embeddings, centroids, scoring, routes, dashboard UI, the Module 4 prompt-feedback write side, and auto-import via watched folder (see Module 7 status note above).
5. **Local persistent deployment** — running the finished app as an always-on local process (own machine or a small home server); not a cloud/serverless deployment (see Stack section)
6. **Electron packaging (Windows exe)** — ✅ done and build-verified (see "Electron packaging — build sequence" below, run #6). Wraps the app with `electron-builder` into a Windows installer/exe; Electron's window points at the existing React frontend and spawns the existing Node backend as a child process inside the packaged app. This was a packaging step at the end, not an architectural change — nothing upstream needed to be built "Electron-aware" except the JS-only CLIP decision (Module 7) already made for exactly this reason, avoiding a bundled Python runtime.

**Electron packaging — build sequence.** Broken into independently-committable sub-steps, mirroring Module 3's AI-outpainting and Module 7's build logs above:
1. **Main process skeleton — ✅ done (dev mode only).** `electron/main.js`: opens a `BrowserWindow`, spawns `backend/server.js` as a child process via the system `node` binary (same process model the app already uses under `npm run dev`/`npm start`, just launched by Electron instead of a terminal), and polls the backend's existing `GET /api/health` route until it responds before loading the window — matching the First-Run Setup section's "fail loud, not silent" philosophy rather than showing a blank window while the backend is still initializing (`getDb()`'s schema init, `initRateLimitCache()`'s rehydration). The window loads Vite's dev server (`http://localhost:5173` by default, overridable via `ELECTRON_START_URL`) — start it alongside this file via the new root `electron:dev` script (`concurrently`, same pattern the existing `dev` script already uses). `before-quit` kills the spawned backend so closing the window doesn't leave an orphaned `node server.js` process bound to the port. `electron/preload.js` is an empty placeholder (`contextIsolation: true`, `nodeIntegration: false`) — the frontend talks to the backend over plain HTTP exactly as it does in a browser tab today, so no `contextBridge` API is needed yet.
2. **Packaged-mode frontend + data paths — ✅ done.** `createWindow()` now calls `loadFile()` against `frontend/dist/index.html` when `app.isPackaged` is true, instead of the dev-mode `loadURL()` against Vite — expects `frontend/dist` to sit alongside `electron/` at the packaged app's root (a layout contract sub-step 3's `electron-builder` config still needs to actually guarantee; nothing enforces it yet). A new `packagedBackendEnv()` points `DB_PATH`/`ARTWORK_UPLOADS_DIR`/`TASTE_FILTER_CANDIDATES_DIR`/`MOCKUP_OUTPUT_DIR` at subfolders of `app.getPath('userData')` when packaged (Electron's standard per-OS writable app-data location, e.g. `%APPDATA%/proetsy` on Windows) — all four were already env-overridable on the backend side (`backend/db/init.js`, `backend/server.js`, `backend/lib/mockup-generator.js`), so no backend changes were needed, only wiring the env vars in from `spawnBackend()`. `MOCKUP_TEMPLATES_DIR` is deliberately left alone: templates ship with the app rather than being written to at runtime, so there's no writability problem to solve for it yet. Dev mode is unaffected either way — `packagedBackendEnv()` returns `{}` when `app.isPackaged` is false, so the backend keeps using its own existing defaults.
3. **`electron-builder` config — ✅ done and build-verified (see run #6 below).** Root `package.json` gained `electron-builder` as a devDependency, a `main` field (`electron/main.js`, so electron-builder/the `electron` CLI can find the app entry), and a `build` config: NSIS as the Windows target, `files` bundling `electron/**`, `frontend/dist/**`, and `backend/**` (excluding `backend/data`, `*.test.js`, `__fixtures__`, and `.env`) — the same asset set `release.yml`'s existing `package-local-bundle` job already assembles for the tarball release, now packaged as an installer instead. `electron:build` (`npm run build -w frontend && electron-builder --win`) is the local build command.
4. **`better-sqlite3` native-module ABI handling — ✅ done and build-verified (see run #6 below).** `main.js`'s new `backendExecutable()` spawns the backend differently depending on `app.isPackaged`: dev mode still spawns via the system `node` binary (unchanged, no rebuild needed — same reasoning as before), but packaged mode now spawns via `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, i.e. Electron's own bundled Node runtime, so a packaged app has no dependency on a system-wide `node` install. That shifts which ABI better-sqlite3 needs to be built against; `build.npmRebuild: true` (sub-step 3's config) delegates that rebuild to electron-builder's own `@electron/rebuild` integration during packaging, and `npm run electron:rebuild` (`electron-builder install-app-deps`) runs the same rebuild on demand. `asarUnpack` in the same config unpacks better-sqlite3's compiled binary out of the asar archive, since a native `.node` file can't be `dlopen`'d from inside one.
5. **Wire into `release.yml` — ✅ done and build-verified (see run #6 below).** Replaced the `TODO(step 6)` header comment with a real `package-electron-win` job (runs on `windows-latest` rather than cross-compiling via Wine, since native-module rebuilds are more reliable on their actual target OS): runs `npm run electron:build` and publishes the resulting NSIS installer to the same GitHub Release the existing tarball job already publishes to, so a tagged release ships both artifacts side by side.

**Update: sub-steps 3–5 have now been run end-to-end against a real electron-builder invocation (run #6, see below) and all three pieces worked together** — `asarUnpack`'s glob, the `ELECTRON_RUN_AS_NODE` spawn, and `npmRebuild`'s interaction with the hoisted-workspace `node_modules` layout. The paragraphs below trace the debugging path it took to get there (runs #1–#5), kept for the record rather than pruned, since the failures and fixes are as informative as the final success.

**Sanity-check finding (pre-first-build, not yet confirmed against a real build) — root `package.json` has no `dependencies` field.** electron-builder's own docs confirm `**/node_modules/**/*` (production deps only) is always auto-included regardless of a custom `files` array, so that part of sub-step 3's config is sound in principle. But electron-builder determines what counts as a "production dependency" by walking the *app's own* `package.json` — which here is root `package.json` (it holds the `main` field and the `build` config). Root's `package.json` only has a `devDependencies` block; `better-sqlite3` and the rest of the backend's runtime deps are declared in `backend/package.json`'s `dependencies` and reach root `node_modules` only via npm workspace hoisting. If electron-builder's production-dependency walk starts from root's (empty) `dependencies` list, it may not discover backend's deps at all — meaning `asarUnpack`'s `**/node_modules/better-sqlite3/**/*` pattern would match nothing not because the unpack config is wrong, but because better-sqlite3 was never copied into the package in the first place. This is a known, still-open class of issue for electron-builder + npm/yarn workspace monorepos (hoisted production deps not found by the packager's dependency walk), independent of the `ELECTRON_RUN_AS_NODE`/ABI-rebuild concern sub-step 4 already documents.
**Suggested first check:** after a build attempt, inspect `release-builds/win-unpacked/resources/app.asar.unpacked/` (and the unpacked `app.asar` itself) to confirm `better-sqlite3` actually landed in the package. If it didn't, the fix is adding a `dependencies` block to root `package.json` (mirroring or re-declaring backend's runtime deps) so electron-builder's root-relative walk finds them, or an explicit `extraResources` entry pointing at the hoisted `node_modules/better-sqlite3` as a fallback. Not flagged as a build-blocking certainty — sub-step 4's `npmRebuild`/`install-app-deps` step may still work here specifically because root is both the workspace root and the app manifest (unlike the nested-subpackage case where this class of electron-builder issue is best documented) — but worth checking before assuming a first-build failure is only the ABI-rebuild issue sub-step 4 already anticipated.

**First real CI run (`release.yml` run #1, `workflow_dispatch` on `main`, commit `16bc8dc`) — the theory above is still unverified, because the build didn't get far enough to test it.** `package-electron-win` failed at the plain `npm ci` step, before `electron-builder` ever ran: `better-sqlite3` has no prebuilt binary for Node 24 on `win32-x64` yet, so `npm ci` fell back to compiling it from source via `node-gyp`, which then failed on the `windows-latest` runner with `gyp ERR! stack Error: Could not find any Visual Studio installation to use`. This is a separate, earlier blocker than the root-`package.json`-`dependencies` question — the asar-contents check is still an open item, one step further down the line than we've reached so far.
**Fix applied (not yet re-verified):** `package-electron-win` is now pinned to Node 22 LTS (`ELECTRON_JOB_NODE_VERSION`, separate from the other jobs' `env.NODE_VERSION: '24'`) instead of chasing node-gyp's Visual-Studio-detection issue on `windows-latest` — better-sqlite3 has long-established prebuilt binaries for LTS Node versions, so this should avoid the from-source compile path entirely. Whether this actually clears the `npm ci` step, and whether the build then reaches far enough to test the asar/`dependencies`-field theory, is still unconfirmed pending the next CI run.
**Also found and fixed in the same run:** `package-local-bundle`'s pre-existing "Publish GitHub Release" step wasn't gated to tag pushes (only the newly-added electron-win one was, in the same pass that added `workflow_dispatch`) — it failed with `GitHub Releases requires a tag` when run manually on a branch. No bad release was published (the step just refused to run without a tag), but it's now gated the same way as the electron-win release step so a `workflow_dispatch` test run doesn't attempt either publish.

**Second CI run (run #2, commit `3699356`) — the Node 22 pin worked, `npm ci` passed, but `electron-builder` itself then hard-failed immediately:** `⨯ Please specify 'version' in the package.json` (root `package.json` had no `version` field — electron-builder requires one; it also warned, non-fatally, that `author` was missing). **Fixed:** added `"version": "0.1.0"` and `"author": "allocsys"` to root `package.json`. Still hadn't reached the asar-contents/`dependencies`-field question by this point either — two blockers in, both about getting a bare-minimum `electron-builder` invocation to run at all on this repo's config, not about the actual hoisted-node_modules theory yet.

**Third CI run (run #3, commit `04023f0`) — real progress: the installer itself was actually built.** electron-builder got all the way through packaging and reached `building block map` (a differential-update artifact for the `.exe`) before failing on `⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"`. electron-builder auto-detects a GitHub remote from the repo and computes publish/update metadata by default, even when it isn't explicitly asked to publish (no `--publish` flag was passed) — that metadata step needs a token this job never provides, since publishing is deliberately handled separately, by `softprops/action-gh-release` uploading the built `.exe` as a workflow-controlled release asset (see the `package-electron-win` job's own "Publish GitHub Release" step). **Fixed:** added `"publish": null` to root `package.json`'s `build` config, disabling electron-builder's own publish/update-metadata detection entirely, since it was never wired to actually publish anything here in the first place. This is the first run where the packaging pipeline itself worked end-to-end up to a genuinely cosmetic/orthogonal failure — the next run is the first real chance to test the asar-contents/`dependencies`-field theory this whole sanity-check thread started from.

**Fourth CI run (run #4, commit `7309d60`) — CONFIRMED: the original sanity-check theory was correct, and it's broader than just `better-sqlite3`.** The build succeeded end-to-end (NSIS installer produced), but the asar-inspection step found `better-sqlite3` in neither `app.asar` (`npx asar list` — `NOT FOUND in app.asar`) nor the unpacked native-binary directory (`app.asar.unpacked/node_modules/better-sqlite3/build/Release/` — `NOT FOUND -- native binary missing from unpacked dir`). Since the root cause is electron-builder walking root `package.json`'s (previously empty) `dependencies` list to decide what production `node_modules` to copy, this almost certainly wasn't a `better-sqlite3`-specific gap — **none of backend's runtime dependencies** (`express`, `jimp`, `chokidar`, `onnxruntime-web`, `ag-psd`, etc.) would have been discoverable by that walk either, meaning the packaged app's spawned backend process would have failed at the very first `require()`/`import` of any backend dependency, not just at the native-module ABI question sub-step 4 was originally worried about.
**Fixed:** added a `dependencies` block to root `package.json` mirroring `backend/package.json`'s full runtime dependency list (same package names and version ranges) so electron-builder's root-relative production-dependency walk actually discovers and copies them. **Known maintenance tradeoff, accepted for now:** this duplicates backend's dependency list in two `package.json` files, which can drift out of sync if one is updated without the other — a future pass could instead have root `package.json` depend on/re-export backend's list programmatically, or move to a build step that copies `backend/package.json`'s `dependencies` into the packaging config automatically, but for now the ROI on that automation isn't worth it for an 11-entry list. **Not yet re-verified against another CI run** — next run should confirm `better-sqlite3` (and spot-check one or two other backend deps, e.g. `express`) now show up in both `app.asar` and the unpacked dir.

**Fifth CI run (run #5, commit `9984bef`) — didn't reach the asar check at all: `npm ci` itself failed, exposing a pre-existing lockfile drift the fourth run's fix couldn't have caused or caught.** `package-electron-win` failed at the plain `npm ci` step with `EUSAGE`: `package-lock.json` and `package.json` are out of sync — the lockfile's hoisted entries are `multer@1.4.5-lts.2`, `concat-stream@1.6.2`, and `readable-stream@2.3.8`, none of which satisfy what both `package.json`s currently declare (`multer@^2.0.2`, resolving to `2.2.0`, pulling in newer `concat-stream`/`readable-stream` transitively). Root and backend `package.json` agree with each other on `multer@^2.0.2` — this isn't a mismatch between the two dependency lists sub-step 4's fix introduced — so `package-lock.json` itself must simply never have been regenerated since backend's `multer` was last bumped from a 1.x line to 2.x. **Why no earlier job caught this:** `verify` and `package-local-bundle` both restore a Linux `node_modules` cache keyed on `hashFiles('package-lock.json')` and only fall back to a real `npm ci` on a cache miss; since that cache was already warm from the fourth run (the lockfile hash hasn't changed), both jobs' install steps were silently skipped again this run (`Install dependencies [skipped]` in the job summary) rather than re-validating the lockfile. `package-electron-win` is the only job that runs an unconditional, cache-free `npm ci` every time (a fresh Windows install, since Linux-built native modules aren't usable there regardless of caching) — making it the first job in this whole packaging effort to ever actually attempt a clean-room install against the real, current lockfile.
**Fixed:** `package-lock.json` regenerated locally (`npm install`, with real registry access) against the current `package.json`s and committed.

**Sixth CI run (run #6) — SUCCESS, full pipeline verified end-to-end.** `npm ci` passed cleanly against the regenerated lockfile. `@electron/rebuild` rebuilt `better-sqlite3` against Electron 33.4.11's ABI without issue (`preparing`/`finished moduleName=better-sqlite3 arch=x64`). electron-builder packaged the app and produced `ProEtsy Setup 0.1.0.exe` via NSIS. The asar-inspection step confirms the fourth run's `dependencies`-block fix actually works now that the lockfile isn't masking it: `better-sqlite3`'s full module tree (`lib/database.js`, `lib/methods/*`, `deps/sqlite3.gyp`, etc., including `build/Release/better_sqlite3.node`) is listed inside `app.asar`, and the compiled native binary is independently confirmed present and unpacked at `app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` (1,720,320 bytes) — the specific split electron-builder needs, since a native `.node` file can't be `dlopen`'d from inside an asar archive. Both open questions this whole thread started from — whether root `package.json` needs its own `dependencies` block, and whether that fix actually survives a real clean-room Windows build — are now confirmed resolved. Electron packaging build-sequence sub-steps 3–5 are complete and build-verified.

**Not yet done, out of scope for this thread:** the installer is unsigned (SmartScreen warning on first run — see Open Discussions), and this run was a `workflow_dispatch` sanity check, not a tagged release, so the built `.exe` was never published to a GitHub Release (release publishing is gated to `refs/tags/*`, deliberately, so a manual dispatch run never ships anything). The next real tagged release (`vX.Y.Z`) will be the first one to actually publish both the tarball and the Windows installer side by side.

(Etsy Uploader is no longer part of the build — publishing is manual.)

---

## Testing & CI/CD

**Test suite:**
- Unit tests (Vitest) for the swappable provider layers (`lib/llm/`, `lib/trends/`, `lib/tags/`) and for pipeline logic that's easy to silently break — partial failure handling, retry behavior, idempotency on re-running a module.
- Integration tests (Supertest) against the Node backend's API routes, run against a throwaway test DB (in-memory or temp-file SQLite) so tests never touch the real local DB. **In place for Module 2's listing routes** (`backend/server.listing-routes.test.js`), **Module 4's trend/prompt routes** (`backend/server.prompt-routes.test.js`), **Module 3's PSD compositing path** (`backend/lib/mockup-generator.psd.test.js`), **Module 3's flat-template mockup routes** (`backend/server.mockup-routes.test.js` — mockup-composer run success/failure/idempotency, the mockups list route's URL fields, and the variant-selection PATCH route including its 404/422 paths), **the server-side pipeline runner** (`backend/server.pipeline-runner-routes.test.js`), **Module 7's taste-filter routes** (`backend/server.taste-filter-routes.test.js`, including the watched-folder pending/watch-status routes), **Module 7's watched-folder watcher** (`backend/lib/taste-filter/watcher.test.js`), **CSV tag/trend import** (`backend/server.csv-import-routes.test.js`), and **the read-only config routes** (`backend/server.config-routes.test.js`).
- **Playwright end-to-end tests — ✅ done.** `e2e/critical-path.spec.js` covers the critical path only (upload artwork → generate listing → review → copy-to-clipboard), not exhaustive UI coverage — driving the real Module 6 dashboard against a real backend process. The backend runs with `LLM_PROVIDER=fixture` (`backend/lib/llm/fixture.js`, a deterministic third provider alongside `gemini`/`claude` in the existing swappable `lib/llm/` interface — no network call, no API key, no output variance between runs, selected the same way `LLM_PROVIDER=claude` already is). Root `playwright.config.js` spins up both the backend (throwaway `DB_PATH`) and frontend dev servers itself via Playwright's `webServer` option — same commands `npm run dev` already uses, so there's no separate "test mode" server setup to keep in sync with real dev usage. Run via `npm run test:e2e` (browsers via `npm run test:e2e:install` first).

**CI (GitHub Actions) — ✅ done.** `.github/workflows/ci.yml`: on every push (any branch) and every PR into `main`, an `install` job runs `npm ci` at the repo root (installs both workspaces via the root `package.json`'s `workspaces` field) and caches `node_modules`, feeding five parallel jobs: `lint` (flat-config ESLint — `eslint.config.js` — backend rules target Node/ESM globals, frontend rules target browser + JSX/React), `backend-test` (`npm run test -w backend` — the Vitest unit + Supertest integration suites described throughout this doc's per-module status notes), `electron-test` (`npm run test:electron` — `electron/main.test.js`, root-scoped Vitest with `electron`/`node:child_process`/`node:http` mocked, no real Electron runtime needed), `frontend-test` (`npm run test -w frontend` — the Vitest + Testing Library component suite: `App.test.jsx` plus one per dashboard component — `JobArtworkAnalysisReview`, `JobListingReview`, `JobMockupReview`, `PromptHelper`, `TasteFilter` — backed by `frontend/vitest.config.js`'s jsdom environment; this suite existed in the repo already but wasn't wired into CI until this pass, so it's now gating pushes/PRs like the others), and `frontend-build` (`npm run build -w frontend` — still kept as its own job alongside `frontend-test`, since a production build catches bundler-level issues, like import paths that only resolve under Vite's own resolution, that a jsdom test run wouldn't). Runs are cancelled/superseded via a concurrency group keyed on branch/PR ref, so pushing a fixup doesn't leave a stale run queued behind it. E2E (Playwright) is deliberately NOT wired into this workflow — those run on a schedule/on-demand basis instead, via the separate `.github/workflows/e2e.yml` (`workflow_dispatch` + a weekly Monday-06:00-UTC schedule), so a full-browser run against two live dev servers never gates a normal push/PR.

**CD (packaging, not deployment) — partially done.** `.github/workflows/release.yml` triggers on `v*.*.*` tag pushes: a `verify` job re-runs the same lint+test+build gate CI does (duplicated rather than `needs: ci`, since CI's own triggers don't include tag pushes), then a `package-local-bundle` job builds the frontend and publishes a tarball (backend source minus `node_modules`/local `data/`, the built `frontend/dist`, and the root config/docs files) as a GitHub Release artifact — enough for a local `npm ci && npm start` deployment without cloning the repo. **This is a stand-in, not the real target**: ARCHITECTURE.md's actual CD step is `electron-builder` producing a Windows installer/exe, and neither an Electron main process nor an `electron-builder` config exist in the repo yet (Suggested build order step 6, still not started) — fabricating a packaging step against config that doesn't exist would just fail on the first tag, so the release workflow does the CD-adjacent work that's real today instead, with a `TODO(step 6)` comment marking where the actual `electron-builder --publish always` step replaces/joins it once that groundwork lands.

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
