# ProEtsy — Modular Architecture

This document defines the modular version of the original build plan. It supersedes nothing — the original plan doc stays as-is — but this is the spec to build against: React frontend, Node.js backend, runnable fully locally first, deployable later.

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
[Module 5: Etsy Uploader]         (optional — draft or publish)
```

Every arrow above is a toggle point. A run can go straight from upload → listing generator → manual copy-paste, skipping mockups and auto-upload entirely (this is Phase 1 / the "quick win").

---

## Modules

### Module 1 — Image Analyzer (optional)
**Input:** artwork file
**Output:** structured description (subject, style, palette, mood) used by Module 2 and for tag matching
**Tech:** Claude API (vision)
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
**Tech:** Claude API

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
**Tech:** Claude API, no Etsy API dependency

### Module 5 — Etsy Uploader (optional)
**Input:** approved listing data + mockup files
**Output:** new Etsy listing (draft or published), single or bulk
**Tech:** Etsy API v3, OAuth
**Can be skipped if:** user wants manual copy-paste to Etsy (this is the Phase 1 / Phase 3 boundary)

### Module 6 — Control Dashboard (core, not a pipeline step)
React frontend that:
- Lets the user drag-and-drop artwork
- Shows a **pipeline config panel**: toggle which modules run for this job (mirrors the config default, but overridable per run)
- Previews and allows editing any generated field before publishing
- Supports bulk mode (multiple artworks through the pipeline at once)
- Keeps a listing history log
- Settings panel: default price, delivery text, shop style conventions, tag library, trend list, mockup template config

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
    { "module": "mockup_composer", "enabled": true },
    { "module": "etsy_uploader", "enabled": false }
  ]
}
```

---

## Stack

- **Frontend:** React
- **Backend:** Node.js
- **Local-first:** entire pipeline (analyzer → generator → mockup composer → review) must run against local storage/local DB before any deployment decision. Deployment target (own VPS, Vercel/Render, etc.) is a separate, later discussion.
- **Database:** same tables as the original plan (listings, images, mockups, tags, settings, prompts), plus a `trends` table (manual entries) and a `pipeline_config` table/JSON file.

---

## Differences from the original plan

| Original plan | This version |
|---|---|
| Etsy API pulls trending data | Trends are manually selected/maintained |
| Canva API or Pillow for mockups | Single `mockup-generator.js`, user's own mockup templates via config lookup |
| Fixed phase order, all-or-nothing | Modular: any step can be enabled/disabled per run |
| Implicit "must deploy" | Local-first; deployment is a later, separate decision |
| Tags freely generated | Tags chosen from a pre-made list, matched to image content |

---

## Suggested build order

1. **Local skeleton**: React frontend + Node backend running locally, DB schema in place, pipeline config wired up (even if most modules are stubs)
2. **Module 2** (Listing Generator) — core, get this solid first, matches original Phase 1
3. **Module 3** (Mockup Composer with own templates) — no external mockup API needed, so this can move up earlier than the original plan's Phase 2
4. **Module 4** (manual-trend prompt helper) — low complexity now that trend-pulling is removed
5. **Module 5** (Etsy Uploader) — last, since it's the only module touching a live external account
6. **Deployment** — separate discussion once the local app works end-to-end
