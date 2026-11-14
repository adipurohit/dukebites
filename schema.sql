CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,          -- source-specific id, e.g. dukecal:..., dukegroups:..., ig:..., manual:...
  source      TEXT NOT NULL,             -- duke-calendar | dukegroups | instagram | manual | tip
  title       TEXT NOT NULL,
  description TEXT,
  start_ms    INTEGER NOT NULL,          -- UTC milliseconds
  end_ms      INTEGER,
  all_day     INTEGER NOT NULL DEFAULT 0,
  location    TEXT,
  url         TEXT,
  org         TEXT,
  food        TEXT,                      -- what food, or the matching snippet
  status      TEXT NOT NULL DEFAULT 'approved',  -- approved | pending | hidden
  created_at  INTEGER,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_ms);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);

CREATE TABLE IF NOT EXISTS subscribers (
  email        TEXT PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | active | unsubscribed
  created_at   INTEGER,
  confirmed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sends (
  day        TEXT PRIMARY KEY,           -- Eastern date, YYYY-MM-DD
  recipients INTEGER,
  events     INTEGER,
  sent_at    INTEGER
);
