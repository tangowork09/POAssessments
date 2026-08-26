-- Two-factor identity for a cohort, off by default.
--
-- Base flow: a respondent proves who they are with the work email the
-- facilitator enrolled. In a trusted internal group that is enough. In a large
-- organisation the same shared link reaches every inbox, and every colleague
-- knows every colleague's address — so the email alone is a name, not a
-- secret, and one person could answer in another's stead.
--
-- With `otp_required` on, the email must also be *controlled*: a one-time code
-- is mailed to it and has to be typed back before the respondent is bound to a
-- roster position. That is the two-way binding — the roster claims the address,
-- and the address proves itself. Per cohort, because it is a per-engagement
-- risk decision, and default off so nothing changes for a group that does not
-- need it. The alternative, per-member magic links (one unguessable link each,
-- emailed), needs no flag: it is just the existing personal link, generated up
-- front from the roster.
ALTER TABLE cohorts ADD COLUMN otp_required INTEGER NOT NULL DEFAULT 0;

-- One live code per (cohort, round, email). Codes are stored hashed, never in
-- the clear, the same rule link tokens follow — a leaked database row must not
-- hand someone a working code. Short-lived and attempt-capped, both enforced
-- in the handler; the row is replaced on each request so only the newest code
-- for an address is ever valid.
CREATE TABLE cohort_otps (
  id          TEXT PRIMARY KEY,
  cohort_id   TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  round_no    INTEGER NOT NULL,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cohort_id, round_no, email)
);
CREATE INDEX idx_cohort_otps_lookup ON cohort_otps (cohort_id, round_no, email);
