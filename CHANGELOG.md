## [Unreleased]
### Added
- First-run onboarding wizard (`OnboardingWizard`): a 3-step flow (Connect Gemini → starter tags → product sizes) that auto-triggers on first launch when nothing is configured yet, reusing the same endpoints and components (`TagsSection`, `MockupTemplates`) as Settings -- no new backend routes.

- `ReviewView`'s mockup category selector now pre-checks the last-used category selection (persisted per shop via the `mockup_last_categories` setting) instead of starting from nothing on every job, and offers an "All enabled templates" quick-select alongside the per-category checkboxes.

- `HistoryView` now supports row multi-select (per-batch and per-job, plus "Select all") with a bulk action bar offering "Re-run pipeline" and "Regenerate flagged" (both via the existing `POST /api/jobs/run-batch`); "Approve all" is present but disabled, since jobs have no "approved" state in the backend yet.
- `ReviewView`'s Mockups tab now has an "Approve all non-flagged" bulk action that re-confirms every loaded mockup that doesn't need review, via the existing per-mockup variant PATCH endpoint -- no new backend route needed.

### Changed
- Extracted `TagsSection` out of `SettingsView.jsx` into `frontend/src/components/TagsSection.jsx` so both Settings and the onboarding wizard share one implementation.

### Fixed
- Electron packaged builds: a backend crash-at-startup or window-load failure with no error dialog and no diagnosable trace (#97, recurrence of #86). Backend stdout/stderr is now captured to a log file under `userData/logs` in packaged builds (previously invisible when launched via Start menu/double-click); `createWindow()`'s `loadFile()` failure, `did-fail-load`, `render-process-gone`, and a synchronous `createWindow()` throw are now all routed through the existing `reportBackendStartupFailure()` error dialog instead of failing silently. Release CI now also verifies `better-sqlite3` actually loads and runs a query under Electron's Node ABI (previously only checked that the file was present, not that it worked) -- this doesn't yet confirm the fix on a real end-user machine, so #97 stays open pending that verification.

## [0.11.5] - 2026-08-18
### Fixed
- Windows Electron installer now includes `frontend/dist` and `backend/` in the packaged app -- previously the release workflow was missing the `npm run build -w frontend` step, causing installed apps to have no UI and fail immediately on startup (#86).

## [0.11.4] - 2026-08-17
### Fixed
- `generateMockupForJob()` no longer leaves an orphaned mockup file on disk if the `product_sizes`/`mockups` DB upsert fails after the file was already written -- the file(s) are now deleted before the error is re-thrown (#85).
- `SetupBanner` no longer disagrees with the backend on when setup is complete: "Setup Incomplete" now follows `/api/setup-status`'s own `readyToRun` flag (`geminiKeyConfigured && hasTagLibrary`) instead of independently requiring Product Sizes too, which the backend has never required to run (#85).

## [0.11.1] - 2026-08-13
### Fixed
- Startup-crashing DB migration ordering bug: the `image_preferences` dedup DELETE now runs after its `ALTER TABLE` migration and before the `idx_image_preferences_image_path` unique index is created (#76).
- Unkeyed list in `ReviewView`'s `AnalysisGrid` (`.map()` now uses a named `Fragment` import with a real `key`) (#76).
- Frontend API client (`useApi.js`): every method now checks HTTP status and parses JSON consistently, and short-circuits on `204 No Content` instead of throwing (#77).
- `SettingsView`'s `PipelineModulesSection`: `MODULE_LABELS` rekeyed to match `pipeline.config.json` (`image_analyzer` / `listing_generator` / `mockup_composer`); dropped a dead `taste-filter` entry (#78).
- `UploadView`'s `MODULE_LABELS` keys corrected to match the same real pipeline module names; skeleton loading state now renders 3 placeholder rows, matching the actual pipeline (#7).
- Flaky `taste-filter` watcher route test: its inline poll loop no longer eats the full global test timeout (#79).

## [0.11.0] - 2026-08-13
### Added
- Proper dropdown selects (Category and Prompt ID) in Taste Filter, replacing free-text/hardcoded fields.

### Changed
- Frontend rebuilt on Tailwind CSS 4 + shadcn/ui.
- Renamed `mj_aspectRatioByCategory` settings key to `mj_aspectRatioByOrientation`.

### Fixed
- Taste Filter's Prompt ID dropdown no longer hardcoded to orientation='portrait'; `api.prompts.list()` can fetch across all orientations.
- Tag Library list now reads the correct `/api/tags` response shape.
- Taste-filter import request now times out instead of leaving the dropzone skeleton stuck indefinitely.
- Numerous stale test/selector and lint fixes following the frontend rebuild.

## [0.9.0] - 2026-08-10
### Added
- Dashboard-editable Shop Conventions: shop and Midjourney conventions now live in the DB and are editable from Settings instead of being hardcoded.
- Backup & Restore: export/import full app configuration (settings, mockup templates, tag library, optionally API keys) as a JSON file from Settings > Shop & Pipeline.
- Taste Filter model auto-download: the CLIP (.onnx) model now downloads automatically on first boot if missing or invalid, with a real progress bar in the UI (poll + SSE) instead of requiring a manual install step.
- One-click "Use Downloads folder" button for the Taste Filter watched-folder setting, backed by a new default-watch-folder endpoint.
- Friendly, user-facing error messages for truncated or failed JSON responses across import, recompute, and pipeline actions, replacing raw browser exceptions.

### Fixed
- `prompt_terms` double-counting on relabel, plus a full-rebuild recompute path and drift backfill (#59).
- Duplicate/contradictory rows in `image_preferences` (Taste Filter) (#56).
- SSE routes no longer buffer behind the proxy, so status events (e.g. model-ready) flush immediately.
- Updated default Gemini model cascade after `gemini-2.5-flash`/`gemini-2.0-flash` were deprecated/shut down.
- Several React hook dependency and stale-selector fixes (`useCallback` memoization, exhaustive-deps compliance).
- Multiple E2E (Playwright) selector and navigation fixes for the listing review and history flows.

### Changed
- Taste Filter auto-compute now defaults to ON for new installs.
- Model download is now decoupled from inference/session logic.
- CI doc-only-change filtering broadened to skip full test runs for any markdown-only push.

## [0.1.0] - 2026-08-02
- Initial release.

[Unreleased]: https://github.com/allocsys/proetsy/compare/v0.11.1...HEAD
[0.11.1]: https://github.com/allocsys/proetsy/compare/v0.11.0...v0.11.1
[0.9.0]: https://github.com/allocsys/proetsy/compare/v0.1.0...v0.9.0
[0.1.0]: https://github.com/allocsys/proetsy/releases/tag/v0.1.0
