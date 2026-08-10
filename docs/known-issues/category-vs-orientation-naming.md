# `category` vs `orientation` naming audit

Tracks: #62

## The problem

`category` is used in this codebase for two unrelated concepts:

1. **Real categories** — a freeform label like a trend's subject (`"home decor"`), a
   mockup template's scene type (`"bedroom"`, `"hallway"`), or a tag's grouping
   (`"animals"`). Correct usage, leave as-is.
2. **Orientation** — `portrait` / `landscape` / `square`, i.e. the print's aspect ratio.
   Currently *also* called `category` throughout Prompt Helper (Module 4) and everything
   downstream of it (Taste Filter / Module 7) — even though `product_sizes` already has
   a correctly-named `orientation` column for the exact same concept. The comment in
   `shop-conventions.js` says so directly: *"matches product-sizes.json's `orientation`
   field"*.

## Instances where `category` actually means orientation

### Backend

| File | Line(s) | What |
|---|---|---|
| `backend/config/shop-conventions.js` | 50 | `aspectRatioByCategory` object + comment |
| `backend/config/shop-conventions.test.js` | 58, 69 | tests reference `aspectRatioByCategory` |
| `backend/config/index.js` | 188 | `mj_aspectRatioByCategory` / `aspectRatioByCategory` config field mapping |
| `backend/config/index.test.js` | 166 | `aspectRatioByCategory: { portrait, landscape, square }` |
| `backend/lib/pipeline-runner.direct.test.js` | 80 | same fixture |
| `backend/lib/prompt-helper/index.js` | 53, 63 | `category` param; error `'category is required (e.g. "portrait", "landscape", "square")'` |
| `backend/lib/prompt-helper/index.test.js` | 50, 86 | `category: 'landscape'`, `"requires a category"` |
| `backend/lib/prompt-helper/prompt.js` | 17–18 | `params.category` JSDoc, directly beside the *real* `trend.category` in the same function |
| `backend/lib/prompt-helper/validate.js` | 21 | `category` param drives `--ar` |
| `backend/lib/prompt-helper/validate.test.js` | 38 | `enforceMidjourneyConventions(..., 'landscape')` |
| `backend/db/schema.sql` | `prompts`, `image_preferences`, `taste_centroids` tables | `category` columns store/propagate the orientation value (contrast with `product_sizes.category`, a genuinely freeform scene type sitting next to `product_sizes.orientation`) |
| `backend/lib/taste-filter/store.js` | throughout | passes the mislabeled `category` through to/from the DB |
| `backend/lib/taste-filter/centroids.js`, `centroids.test.js` | 61 | `category: 'landscape'` fixture |
| `backend/lib/taste-filter/scoring.js`, `scoring.test.js` | 145 | per-category score keyed on the same field |
| `backend/server.prompt-routes.test.js` | 44, 107 | `category: 'landscape'` |
| `backend/server.config-routes.test.js` | 24 | `aspectRatioByCategory.portrait` |

### Frontend

| File | Line(s) | What |
|---|---|---|
| `frontend/src/PromptHelper.jsx` | 4, 17 | `const CATEGORIES = ['portrait', 'landscape', 'square']`; `category` state; UI label "Category:" (`#prompt-category-select`) |
| `frontend/src/PromptHelper.test.jsx` | 6, 37 | fixture `category: 'portrait'`; `selectOptions('Category:', 'landscape')` |
| `frontend/src/ShopConventions.jsx` | 49 | `cfg.midjourney.aspectRatioByCategory` |
| `frontend/src/ShopConventions.test.jsx` | 23 | `aspectRatioByCategory: { botanical: '3:4' }` |

### Related — needs a decision, not a clear-cut rename

- `frontend/src/TasteFilter.jsx:111` — `category` state, labeled "Curation name" in the
  UI (placeholder `e.g. square-canvas`). This one is freeform, not locked to
  portrait/landscape/square, but it flows into/out of the same `category` DB columns
  above (`handleLabel` sends `category: candidate.category`, tracing back to a Prompt
  Helper `category`). Decide whether this becomes `orientation` too, or is intentionally
  a separate freeform "curation group" that happens to reuse the column name today.

## Not affected — real "category", leave alone

`trends.category`, `product_sizes.category` (note: this table already has its own,
correctly-named `orientation` column), `tags.category`, `frontend/src/MockupTemplates.jsx`
bulk category, `backend/lib/csv.js` term/category CSV parsing,
`backend/lib/tags/user-list.js`.

## Suggested fix

Rename the orientation-flavored `category` → `orientation` end-to-end:

- Config keys (`mj_aspectRatioByCategory` → `mj_aspectRatioByOrientation` or similar)
- Function params/JSDoc across `prompt-helper/` and `taste-filter/`
- DB columns on `prompts`, `image_preferences`, `taste_centroids` (needs a migration —
  these tables already hold data)
- API request/response bodies (`/api/prompts/generate`, `/api/taste-filter/*`)
- `frontend/src/PromptHelper.jsx` state, constant, and UI label
- All corresponding test fixtures/assertions listed above

`TasteFilter.jsx`'s "Curation name" field should be resolved separately per the note
above before renaming its column.
