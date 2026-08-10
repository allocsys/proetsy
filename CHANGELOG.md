## [Unreleased]

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

[Unreleased]: https://github.com/allocsys/proetsy/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/allocsys/proetsy/compare/v0.1.0...v0.9.0
[0.1.0]: https://github.com/allocsys/proetsy/releases/tag/v0.1.0
