# ProEtsy

Local-first pipeline that turns artwork into ready-to-paste Etsy listings (and mockups). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Status

All modules are built and tested (unit, idempotency, and route-level integration tests exist for every module unless noted) — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current architecture, not a build log. Etsy publishing stays manual by design: the app produces an approved listing and mockups, and you paste them into Etsy yourself.

Pipeline overview:

```
Module 7: Taste Filter (optional, pre-pipeline)
      ↓
Upload Artwork
      ↓
Module 1: Image Analyzer (optional)
      ↓
Module 2: Listing Generator (core)
      ↓
Module 3: Mockup Composer (optional)
      ↓
Review / Edit (human-in-the-loop, always)
      ↓
Done — publish to Etsy manually
```

## Quick start

```bash
npm install
cp backend/.env.example backend/.env   # then fill in at least one Gemini key
npm run dev
```

This starts the backend on http://localhost:4000 and the frontend (Vite) on http://localhost:5173, proxying `/api` calls to the backend.

On first launch, the dashboard checks its own setup state (Gemini key present, DB initialized, at least one product size configured) and opens into a setup screen if anything's missing — see ARCHITECTURE.md's First-Run Setup section.

## Structure

```
backend/
  server.js          — Express app entry point
  db/                — SQLite schema + init
  config/             — pipeline.config.json, product-sizes.json
  lib/llm/            — Gemini (primary) / Claude (fallback) provider layer
  lib/trends/         — manual+CSV / Etsy Open API provider layer
  lib/tags/           — user tag-list provider layer
  lib/image-analyzer/ — Module 1
  lib/listing-generator/ — Module 2
  lib/mockup-generator.js, lib/mockup-templates/ — Module 3
  lib/prompt-helper/  — Module 4
  lib/taste-filter/   — Module 7
frontend/
  src/               — React dashboard (Module 6)
```

## Testing

- `npm test` — unit + integration tests (Vitest, Supertest)
- `npm run test:e2e` — Playwright critical-path E2E, against a deterministic fixture LLM provider (no network calls)

See ARCHITECTURE.md's Testing & CI/CD section for what runs in CI vs. on-demand.

## Runs on Termux (Android)

The stack is pure JS/WASM by design (see ARCHITECTURE.md's WASM decision for Module 7) — no native module compilation required.

## Packaging

Electron packaging (Windows exe) is built and CI-verified. See ARCHITECTURE.md's Packaging & Deployment section for details, including the current unsigned-installer SmartScreen caveat.
