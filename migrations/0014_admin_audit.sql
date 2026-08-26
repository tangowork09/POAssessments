-- What the console did, and what it did it to.
--
-- The console can rotate a link, replace a roster, close a round or delete a
-- cohort — actions that are meant to be irreversible and are occasionally
-- performed by mistake. Until now the only record of any of them was their
-- effect. This table records the act: who, when, what, and — the part that
-- makes recovery possible — the state of the row *before* it changed.
--
-- `before_json` is what turns "someone re-issued the link and now the old one
-- 404s" into something fixable: the previous token is in the log, and putting
-- it back is re-hashing a string. Nothing here replaces a backup; it is the
-- narrow, high-value slice a facilitator actually needs at 9pm.
CREATE TABLE admin_audit (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  -- Kept as text rather than a foreign key: the log must survive the admin
  -- account being deleted, which is exactly when it is most worth reading.
  admin_id    TEXT,
  admin_email TEXT,
  -- A verb the console names, e.g. 'cohort.link.reissue'. Dotted, so a prefix
  -- filter reads as a subject.
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  -- One line a human reads without opening the JSON.
  summary     TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json  TEXT,
  method      TEXT,
  path        TEXT,
  status      INTEGER,
  ip          TEXT
);
CREATE INDEX idx_admin_audit_at ON admin_audit (at DESC);
CREATE INDEX idx_admin_audit_entity ON admin_audit (entity, entity_id, at DESC);
CREATE INDEX idx_admin_audit_action ON admin_audit (action, at DESC);
