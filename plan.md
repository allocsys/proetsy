# Frontend UX Simplification Plan

Goal: reduce manual configuration surface area and make Proetsy feel like a polished product rather than an admin panel, without breaking the existing pipeline/job/listing data model.

Work through phases **in order** — later phases assume earlier ones are done (e.g. bulk actions assume a single source of truth for pipeline config).

---

## Phase 1 — Remove duplicate configuration (highest priority, low risk)

**Problem:** Pipeline module toggles (Image Analyzer / Listing Generator / Mockup Composer) exist in both `UploadView.jsx` and `SettingsView.jsx` (Shop & Pipeline tab), each with their own copy of `MODULE_LABELS` and independent state.

- [x] Make Settings → Shop & Pipeline the single source of truth for pipeline defaults (already patches `pipeline_defaults` via `api.settings.patch`)
- [x] In `UploadView.jsx`, replace the full toggle list with a collapsed summary: "Using default pipeline (Image Analyzer, Listing Generator, Mockup Composer) — Edit" that deep-links to Settings
- [x] Extract `MODULE_LABELS` into a shared constant (`frontend/src/lib/pipelineModules.js`) instead of duplicating it in both files
- [x] Confirm `pipeline_overrides` per-job override still works for the rare case a user wants a one-off change (kept as an "Override for this upload" expandable, not default-visible)

## Phase 2 — Progressive disclosure in Settings (Basic vs Advanced)

**Problem:** Rate Limits, Watch Folder, and Taste Filter Auto threshold sit at the same visual priority as API keys — most users never touch them.

- [x] Add a Basic/Advanced split (implemented as a page-level "Show advanced settings" toggle in `SettingsView.jsx`, persisted to `localStorage` like `App.jsx`'s sidebar-collapsed flag)
- [x] Basic (always visible): API Keys, Tags & Trends, Shop Defaults, Shop Conventions, Backup & Restore
- [x] Advanced (hidden by default): Watch Folder, Rate Limits, Taste Filter Auto threshold (entire Automation & Diagnostics tab), Pipeline module toggles (within Shop & Pipeline tab)
- [x] Ship a sane default for `taste_filter_auto_threshold` (0.7) so the slider only needs to be touched once a user has enough rated data to want to tune it
- [ ] Consider collapsing Settings from 4 tabs to fewer using this split -- **deferred**: kept the existing 4 tabs since the toggle already hides the low-priority content within them without a bigger IA change; revisit if tab count itself becomes a complaint

## Phase 3 — First-run onboarding wizard

**Problem:** Setup (API key, tags, product size) is scattered across Settings tabs, surfaced only via `SetupBanner`.

- [x] New component `frontend/src/views/OnboardingWizard.jsx`, 3 steps:
  1. Connect API key (simplify to a single "Connect Gemini" button — see Phase 6)
  2. Import or generate starter tags (reuse `TagsSection` CSV import, or offer a "Generate starter tags" AI action) -- implemented via reused `TagsSection`; the AI-generate variant was left as a future option
  3. Confirm/set product sizes (reuse relevant part of Mockup Templates) -- implemented by reusing the full `MockupTemplates` component rather than a trimmed subset
- [x] Trigger wizard automatically on first launch when `setup-status` shows nothing configured; otherwise normal `SetupBanner` behavior stands
- [x] Wizard writes to the same endpoints Settings already uses — no new backend routes needed

## Phase 4 — Reduce manual per-listing editing (Review → Listings tab)

**Problem:** Users manually notice and fix forbidden words / AI-disclosure phrases / delivery-detail phrases that the server already knows about.

- [x] Backend: when generating/saving a listing, auto-strip known-forbidden words and disclosure/delivery phrases server-side before returning the draft (`backend/lib/listing-generator`) -- already in place: `enforceConventions` (validate.js) runs on both initial generation (index.js) and on every manual edit (PATCH /api/jobs/:id/listings/:listingId in server.js), and the route returns a `warnings` array describing what was stripped
- [x] Frontend: replace the current "contains X, will be removed on save" warning-before-the-fact pattern with a post-save diff notice: "Removed 2 words: X, Y" (toast or inline note) -- removed the pre-save forbidden-word/AI-disclosure/delivery-phrase hint text in `ListingCard` (ReviewView.jsx); on save, the server's `warnings` now surface via a toast description as well as the existing inline amber note
- [x] Keep the char-counters (title/tags length) as-is — those are legitimately useful live feedback, not the problem -- untouched

## Phase 5 — Smart defaults for mockup generation

**Problem:** Mockup category checkboxes must be manually re-selected on every job.

- [x] Persist "last used category selection" per shop (new `settings` key, e.g. `mockup_last_categories`) via existing `api.settings.patch` -- persisted as a JSON array string on the generic `settings` key/value table, written each time `Generate Mockups` runs (`MockupCategorySelector` in `ReviewView.jsx`)
- [x] On `MockupCategorySelector` mount, pre-check the last-used set instead of nothing -- categories no longer present among the currently configured templates are filtered out rather than left checked
- [x] Add an "All enabled templates" quick-select option alongside per-category checkboxes

## Phase 6 — Bulk actions (highest leverage for batch workflows)

**Problem:** Tags, listings, and mockups are all edited one at a time; History has no multi-select.

- [x] `HistoryView.jsx`: add row multi-select + bulk action bar ("Approve all", "Regenerate all flagged", "Re-run pipeline") -- "Re-run pipeline" and "Regenerate flagged" both call the existing `POST /api/jobs/run-batch`; "Approve all" is shown disabled with an explanatory tooltip since jobs have no "approved" concept in the schema today
- [x] `ReviewView.jsx` Mockups tab: "Approve all non-flagged" action alongside existing per-mockup variant selection -- re-confirms each non-flagged mockup's current `selected_variant` via the existing per-mockup PATCH endpoint
- [x] Backend: confirm/add bulk endpoints as needed -- confirmed `runBatch` is reusable as-is for History; mockup bulk-approve did not need a new endpoint, since looping the existing single-mockup PATCH client-side is sufficient (non-flagged mockups already carry a valid variant, so there's nothing new to add server-side)

## Phase 7 — Visual/professional polish pass

- [ ] Settings: replace the 3-field "Provider dropdown + password input + label" API key form with a connect-button pattern (e.g. "Connect Gemini" → modal with just the key field, provider pre-selected)
- [ ] Audit empty states across views (Upload, History, Review tabs, Tags/Trends) for consistent illustration + guidance copy, matching the pattern already used in a few places
- [ ] Consistency pass on button/icon usage and spacing once the structural changes above land (do this last so it's not redone mid-restructure)

---

## Sequencing notes

- Phases 1–2 touch only `SettingsView.jsx` / `UploadView.jsx` — safe to do first, low blast radius.
- Phase 3 (wizard) is additive — no existing behavior removed, can ship independently once Phase 1 defaults exist to point to.
- Phase 4 requires a backend change (auto-strip on save) — coordinate with `backend/lib/listing-generator` before touching `ReviewView.jsx`.
- Phase 5 is small and independent — can be done any time after Phase 1.
- Phase 6 is the largest change and depends on Phase 1 (single pipeline config source) being in place first.
- Phase 7 should be last so polish isn't redone after structural changes.
