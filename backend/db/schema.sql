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
  mockup_template_path TEXT
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
