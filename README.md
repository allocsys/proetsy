# ProEtsy

Local-first pipeline that turns artwork into ready-to-paste Etsy listings (and mockups). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Status

Step 1 of the build order: **local skeleton**. Backend + frontend run and talk to each other; the SQLite schema is in place; the three provider layers (`lib/llm`, `lib/trends`, `lib/tags`) are scaffolded with their v1/stub implementations. Modules 1–4 and 7 are not yet built.

## Quick start

```bash
npm install
cp backend/.env.example backend/.env   # then fill in at least one Gemini key
npm run dev
```

This starts the backend on http://localhost:4000 and the frontend (Vite) on http://localhost:5173, proxying `/api` calls to the backend.

## Structure

```
backend/
  server.js          — Express app entry point
  db/                — SQLite schema + init
  config/            — pipeline.config.json, product-sizes.json, trends.json
  lib/llm/           — Gemini (primary) / Claude (fallback) provider layer
  lib/trends/        — manual+CSV / Etsy Open API provider layer
  lib/tags/          — user tag-list provider layer
frontend/
  src/               — React dashboard (Module 6)
```

## Runs on Termux (Android)

The stack is pure JS/WASM by design (see ARCHITECTURE.md's WASM decision for Module 7) — no native module compilation required.
