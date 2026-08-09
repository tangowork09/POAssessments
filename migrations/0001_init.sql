-- Assessment Platform — initial schema.
--
-- Multi-assessment from day one: the `assessments` table drives linking,
-- questions, scoring config and reporting. Shipping a second inventory means
-- inserting an assessment row, its questions and its scoring_styles rows —
-- no code change to the linking or candidate flow.

-- ---------------------------------------------------------------- assessments
CREATE TABLE assessments (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('live','planned','retired')),
  question_count INTEGER NOT NULL DEFAULT 0,
  per_page       INTEGER NOT NULL DEFAULT 8,
  min_answer     INTEGER NOT NULL DEFAULT 0,
  max_answer     INTEGER NOT NULL DEFAULT 5,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE questions (
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  no            INTEGER NOT NULL,
  text          TEXT NOT NULL,
  PRIMARY KEY (assessment_id, no)
);

-- Scoring configuration lives in data, not code, so a new inventory needs no
-- deploy. `items` is a JSON array of 1-based question numbers.
CREATE TABLE scoring_styles (
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  side          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  items         TEXT NOT NULL,
  PRIMARY KEY (assessment_id, key)
);

-- ----------------------------------------------------------------- candidates
CREATE TABLE candidates (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  organisation  TEXT NOT NULL DEFAULT '',
  age_band      TEXT NOT NULL DEFAULT '',
  experience_band TEXT NOT NULL DEFAULT '',
  gender        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_candidates_email ON candidates (email);

-- ---------------------------------------------------------------------- links
-- Opaque random tokens. The URL carries a high-entropy random string and
-- nothing else — no assessment name, no candidate identity, no encoded id.
-- Only a keyed hash of the token is stored, so a database copy cannot be
-- turned back into working links.
--
-- kind = 'personal' : (candidate_id, assessment_id). Used in invite mail;
--                     enables per-candidate tracking and resume.
-- kind = 'generic'  : (assessment_id) only, candidate_id NULL. Exactly one per
--                     assessment. A visitor enters their details and gets their
--                     own response row plus a personal continuation link.
--
-- Links never expire. There is no TTL and no expiry check anywhere in the
-- codebase; `active` is toggled only by an explicit admin action.
CREATE TABLE links (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('personal','generic')),
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  candidate_id  TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT,
  CHECK ((kind = 'generic' AND candidate_id IS NULL) OR (kind = 'personal' AND candidate_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_links_generic_per_assessment
  ON links (assessment_id) WHERE kind = 'generic';
CREATE INDEX idx_links_candidate ON links (candidate_id);

-- ------------------------------------------------------------------ responses
CREATE TABLE responses (
  id             TEXT PRIMARY KEY,
  assessment_id  TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  link_id        TEXT REFERENCES links(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','in_progress','completed')),
  answered_count INTEGER NOT NULL DEFAULT 0,
  resume_page    INTEGER NOT NULL DEFAULT 0,
  invited_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  completed_at   TEXT,
  UNIQUE (assessment_id, candidate_id)
);
CREATE INDEX idx_responses_status ON responses (status);
CREATE INDEX idx_responses_completed ON responses (completed_at);

CREATE TABLE answers (
  response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  no          INTEGER NOT NULL,
  value       INTEGER NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (response_id, no)
);

-- -------------------------------------------------------------------- reports
CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  response_id  TEXT NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  scores_json  TEXT NOT NULL,
  pdf          BLOB,
  pdf_bytes    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------- admin
CREATE TABLE admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT 'Administrator',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------- outbox
-- Every outbound mail is recorded here whether or not a provider is configured.
-- With no RESEND_API_KEY the row is the delivery: dev works with no account.
CREATE TABLE mail_outbox (
  id           TEXT PRIMARY KEY,
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html         TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'generic',
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','logged')),
  provider_id  TEXT,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);
CREATE INDEX idx_outbox_status ON mail_outbox (status);
CREATE INDEX idx_outbox_created ON mail_outbox (created_at);

-- ------------------------------------------------------------- bulk invites
CREATE TABLE invite_batches (
  id          TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  total       INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','partial')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE invite_batch_items (
  id           TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL REFERENCES invite_batches(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  first_name   TEXT NOT NULL DEFAULT '',
  last_name    TEXT NOT NULL DEFAULT '',
  organisation TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error        TEXT,
  candidate_id TEXT
);
CREATE INDEX idx_batch_items_batch ON invite_batch_items (batch_id, status);

-- --------------------------------------------------------------- rate limits
-- Fixed-window counters for unauthenticated endpoints.
CREATE TABLE rate_limits (
  bucket      TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- Daily send cap ledger (one row per UTC day).
CREATE TABLE send_ledger (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
