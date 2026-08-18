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

- [ ] Add a Basic/Advanced split within the "Automation & Diagnostics" tab (or promote to top-level toggle across Settings)
- [ ] Basic: API Keys, Tags & Trends, Shop Defaults
- [ ] Advanced (collapsed by default): Watch Folder, Rate Limits, Taste Filter Auto threshold, Pipeline module toggles
- [ ] Ship a sane default for `taste_filter_auto_threshold` (0.7) so the slider only needs to be touched once a user has enough rated data to want to tune it
- [ ] Consider collapsing Settings from 4 tabs to fewer using this split (e.g. "Shop" tab absorbs Shop & Pipeline + Automation-Basic; "Advanced" tab absorbs the rest)

## Phase 3 — First-run onboarding wizard

**Problem:** Setup (API key, tags, product size) is scattered across Settings tabs, surfaced only via `SetupBanner`.

- [ ] New component `frontend/src/views/OnboardingWizard.jsx`, 3 steps:
  1. Connect API key (simplify to a single "Connect Gemini" button — see Phase 6)
  2. Import or generate starter tags (reuse `TagsSection` CSV import, or offer a "Generate starter tags" AI action)
  3. Confirm/set product sizes (reuse relevant part of Mockup Templates)
- [ ] Trigger wizard automatically on first launch when `setup-status` shows nothing configured; otherwise normal `SetupBanner` behavior stands
- [ ] Wizard writes to the same endpoints Settings already uses — no new backend routes needed

## Phase 4 — Reduce manual per-listing editing (Review → Listings tab)

**Problem:** Users manually notice and fix forbidden words / AI-disclosure phrases / delivery-detail phrases that the server already knows about.

- [ ] Backend: when generating/saving a listing, auto-strip known-forbidden words and disclosure/delivery phrases server-side before returning the draft (`backend/lib/listing-generator`)
- [ ] Frontend: replace the current "contains X, will be removed on save" warning-before-the-fact pattern with a post-save diff notice: "Removed 2 words: X, Y" (toast or inline note)
- [ ] Keep the char-counters (title/tags length) as-is — those are legitimately useful live feedback, not the problem

## Phase 5 — Smart defaults for mockup generation

**Problem:** Mockup category checkboxes must be manually re-selected on every job.

- [ ] Persist "last used category selection" per shop (new `settings` key, e.g. `mockup_last_categories`) via existing `api.settings.patch`
- [ ] On `MockupCategorySelector` mount, pre-check the last-used set instead of nothing
- [ ] Add an "All enabled templates" quick-select option alongside per-category checkboxes

## Phase 6 — Bulk actions (highest leverage for batch workflows)

**Problem:** Tags, listings, and mockups are all edited one at a time; History has no multi-select.

- [ ] `HistoryView.jsx`: add row multi-select + bulk action bar ("Approve all", "Regenerate all flagged", "Re-run pipeline")
- [ ] `ReviewView.jsx` Mockups tab: "Approve all non-flagged" action alongside existing per-mockup variant selection
- [ ] Backend: confirm/add bulk endpoints as needed (check `backend/lib/jobs.js` `runBatch` — likely reusable; mockup bulk-approve may need a new endpoint)

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
