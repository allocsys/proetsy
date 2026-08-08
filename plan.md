# UX/Workflow Findings — Dashboard Review

Findings from a review of `frontend/src/App.jsx` and `ARCHITECTURE.md`. These are front-end/UX friction points, not architecture problems — the backend design holds up fine.

## 1. Pipeline toggles are duplicated and confusing — ✅ Done (`276a3a5`)
There are two places to turn pipeline modules on/off:
- Settings → "Pipeline Modules" (persisted default, `togglePersistedModule`)
- Upload page → toggles inside the pipeline section (session-only override via `overrides` state)

Both render the same checkbox list off `pipelineDefault.pipeline`, but nothing in the UI explains which one wins for a given run, or that one is a saved default and the other a one-time override. A user changing one could reasonably assume they changed the other.

**Fix direction:** Either merge into a single control with an explicit "apply to this run only" vs "save as default" choice, or visually/textually separate the two so it's obvious they're different scopes.

**What shipped:** Upload-page copy now explicitly points to Settings → Pipeline Modules as the actual saved default (previously it wrongly pointed to `pipeline.config.json`). Each toggle that differs from the saved default is labeled "(changed for this upload)", and a "Reset to saved default" button appears whenever any override is active. Settings copy now leads with "This is the saved default" to make the asymmetry explicit.

## 2. Sidebar defaults to collapsed — ✅ Done (`d538ce6`)
`sidebarCollapsed` initializes to `true`, so a first-time user lands on icon-only nav with no labels until they find and click the collapse toggle.

**Fix direction:** Default to expanded; persist the user's preference (e.g. localStorage) once they collapse it themselves.

**What shipped:** Sidebar now defaults to expanded on first visit. Once a user collapses or expands it, the choice is saved to `localStorage` (`proetsy_sidebar_collapsed`) and restored on future visits.

## 3. Job Review requires manually typing a job ID — ✅ Done (`974a662`, `5c31997`)
The "Review a Job" view is a bare number input + "Load job" button — no picker, no autocomplete. Listing History already has a clickable table of jobs, but if a user lands on Review first they're stuck guessing/typing IDs.

**Fix direction:** Add a dropdown/search sourced from `/api/jobs`, or default Review to showing recent jobs when no ID is loaded.

**What shipped:** Jobs now refresh whenever the Review view is opened. A "Pick a recent job" dropdown (up to 25 most-recently-updated jobs, sorted by `updated_at`) sits next to the manual Job ID field. When no job is loaded, the empty state now lists the 10 most recent jobs as a clickable table instead of just telling the user to type an ID.

## 4. Irreversible AI action with only a confirm() dialog — ✅ Done (`5d18052`, `0fe6c37`, `f6f63b4`, `9841bb3`)
"Suggest categories for uncategorized tags" (`backfillTagCategories`) writes AI-guessed categories immediately with no preview. The confirm dialog itself admits this: *"Suggestions are written immediately and can't be previewed first."*

**Fix direction:** Show a preview/diff of suggested categories before committing, or make the write itself easily reversible (e.g. one-click revert of the last backfill run).

**What shipped:** Backend now supports `POST /api/tags/backfill-categories?dry_run=true`, which computes the exact same tag→category matches without writing anything (matching logic is deterministic, so preview and apply always agree — covered by a new test). The button now says "Suggest categories…", fetches a preview first, and shows the full list of proposed changes with explicit Apply / Cancel buttons — the native `confirm()` dialog is gone.

## 5. Inconsistent delete UX
Tags, trends, and API keys all delete via native `window.confirm()` popups — jarring against an otherwise custom-styled dashboard, and inconsistent with item 4 above, which also confirms but can't be undone even after confirming.

**Fix direction:** Standardize on in-app confirmation UI (styled modal or inline "confirm delete" state) instead of native browser dialogs, applied consistently across all destructive actions.

## 6. Bulk upload is N sequential round-trips
`handleFiles` loops `for (const artwork of artworks)` and does one `POST /api/jobs` per file, awaited serially, instead of a single bulk-create endpoint.

**Fix direction:** Add a `POST /api/jobs/bulk` endpoint accepting an array of artwork IDs, or at minimum fire the per-file requests concurrently (`Promise.all`) instead of sequentially.

## 7. Everything dumped into one Settings mega-page
Tags, trends, shop conventions, API keys (sensitive), automation/watch-folder config, and rate-limit diagnostics are all one long scroll with no sub-navigation. Sensitive key management sits directly next to trivial fields like default price.

**Fix direction:** Split into sub-tabs (e.g. Tags & Trends / API Keys / Automation / Diagnostics) or at minimum visually separate sensitive sections with stronger boundaries.
