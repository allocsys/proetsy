-- ProEtsy SQLite schema. See ARCHITECTURE.md -> Database Schema for the design rationale.

CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  image_analysis TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id),
  overall_status TEXT NOT NULL DEFAULT 'pending',
  manual_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(job_id, module_name)
);
CREATE INDEX IF NOT EXISTS idx_job_modules_job_id ON job_modules(job_id);

CREATE TABLE IF NOT EXISTS product_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size_key TEXT NOT NULL UNIQUE,
  dimensions TEXT,
  dpi INTEGER,
  orientation TEXT,
  mockup_template_path TEXT,
  -- Nullable — only meaningful for .psd templates; names the PSD layer whose bounds the
  -- artwork is placed into. See ARCHITECTURE.md -> Module 3 -> "Template formats".
  placement_layer TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  variation TEXT NOT NULL,
  title TEXT,
  description TEXT,
  tags TEXT,
  tag_alternates TEXT,
  edited_at TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id, variation)
);
CREATE INDEX IF NOT EXISTS idx_listings_job_id ON listings(job_id);

CREATE TABLE IF NOT EXISTS mockups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  product_size_id INTEGER NOT NULL REFERENCES product_sizes(id),
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- AI-outpainting review step (ARCHITECTURE.md -> Module 3 -> "AI-outpainting fallback"
  -- step 5/build order). Nullable — only populated when an outpaint attempt actually
  -- succeeded for this mockup; `file_path` above still holds whichever variant is
  -- currently selected (smart_crop by default), so existing readers of `file_path` don't
  -- need to change.
  ai_extended_path TEXT,
  -- Smart-crop variant's own file path, kept independently of `file_path` so the step-6
  -- PATCH variant route can always restore it. `file_path` gets overwritten to track
  -- whichever variant is currently selected, so once the user switches to ai_extended,
  -- file_path alone can no longer recover the smart-crop file. Always populated —
  -- composeMockup() always produces a smart-crop variant.
  smart_crop_path TEXT,
  -- Set when both a smart-crop and an AI-extended variant exist and the user hasn't picked
  -- one yet; cleared once `selected_variant` is set via the dashboard review step.
  needs_review INTEGER NOT NULL DEFAULT 0,
  selected_variant TEXT NOT NULL DEFAULT 'smart_crop',
  UNIQUE(job_id, product_size_id)
);
CREATE INDEX IF NOT EXISTS idx_mockups_job_id ON mockups(job_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_text TEXT NOT NULL,
  category TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  category TEXT,
  source TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trends_term ON trends(term);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trend_id INTEGER REFERENCES trends(id),
  category TEXT,
  prompt_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS image_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path TEXT NOT NULL,
  embedding BLOB,
  label TEXT NOT NULL,
  category TEXT,
  prompt_id INTEGER REFERENCES prompts(id),
  promoted_artwork_id INTEGER REFERENCES artworks(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_image_preferences_category ON image_preferences(category);

CREATE TABLE IF NOT EXISTS taste_centroids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  kept_centroid BLOB,
  discarded_centroid BLOB,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_terms (
  term TEXT PRIMARY KEY,
  kept_count INTEGER NOT NULL DEFAULT 0,
  discarded_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Durable backing store for the LLM provider layer's in-process cooldown cache. See
-- ARCHITECTURE.md -> LLM Provider Layer -> "Rate-limit cooldown tracking" / "Cooldown
-- escalation instead". Rows are keyed by a key's positional index in GEMINI_API_KEYS
-- (key_index), never the raw key string, plus the model. Rehydrated into the in-memory
-- Map on backend startup; written to on every 429; cleared (limited_until = NULL,
-- consecutive_hits = 0) on a successful call to that pair.
CREATE TABLE IF NOT EXISTS llm_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  limited_until TEXT,
  consecutive_hits INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(key_index, model)
);
