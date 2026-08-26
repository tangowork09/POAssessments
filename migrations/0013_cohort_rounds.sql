-- Rounds: the same group, rated again, without the two runs pooling.
--
-- A cohort was one run of one instrument on one group at one point in time, and
-- re-rating meant building a second cohort by hand. What a facilitator actually
-- runs is a cadence — the same leadership team every month or every quarter —
-- and they want one place that holds the lot.
--
-- So a cohort now holds rounds. Everything that is an *observation* is scoped to
-- a round: the link people answer through, the responses they give, and the
-- reports built from them. Everything that is the *group* stays on the cohort:
-- the roster and its positions, the rater floor, the tie threshold, the alias.
-- That split is what makes September and October comparable — position 7 is the
-- same person in both — while keeping them apart in every average.
--
-- Nothing here is optional for existing data: a cohort with no round is a cohort
-- whose responses belong to nothing, so every existing cohort is given round 1
-- and every existing row is stamped with it.

CREATE TABLE cohort_rounds (
  id         TEXT PRIMARY KEY,
  cohort_id  TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  -- 1-based and never reused, the same rule roster positions follow: a round
  -- number is an address that appears in stored responses and reports.
  no         INTEGER NOT NULL,
  -- What the facilitator calls it — "September 2026", "Q3". Optional; the
  -- console falls back to "Round 2".
  label      TEXT NOT NULL DEFAULT '',
  opened_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Set when a later round starts, or when the cohort is closed. A round with a
  -- date here takes no more responses; its link says so rather than 404ing,
  -- because the person holding it is not doing anything wrong.
  closed_at  TEXT,
  UNIQUE (cohort_id, no)
);
CREATE INDEX idx_cohort_rounds_open
  ON cohort_rounds (cohort_id) WHERE closed_at IS NULL;

-- Every cohort that exists today is round 1, opened when the cohort was and
-- closed when the cohort was.
INSERT INTO cohort_rounds (id, cohort_id, no, label, opened_at, closed_at)
SELECT 'crd_' || lower(hex(randomblob(16))), id, 1, '', created_at, closed_at
  FROM cohorts;

-- The round each row belongs to. Default 1 is correct for every existing row:
-- there was only ever one round, and it is now called round 1.
ALTER TABLE links ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE responses ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cohort_reports ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1;

-- One generic link per cohort *per round*, rather than per cohort. Round 2 gets
-- its own door; round 1's keeps working and keeps saying it is closed.
DROP INDEX idx_links_generic_per_assessment;
CREATE UNIQUE INDEX idx_links_generic_per_assessment
  ON links (assessment_id, COALESCE(cohort_id, ''), round_no) WHERE kind = 'generic';
CREATE INDEX idx_links_cohort_round ON links (cohort_id, round_no) WHERE cohort_id IS NOT NULL;

-- One response per person per instrument per cohort *per round*. Without the
-- round in this index the same leader answering October would collide with
-- their own September response and be refused.
DROP INDEX idx_responses_identity;
CREATE UNIQUE INDEX idx_responses_identity
  ON responses (assessment_id, candidate_id, COALESCE(cohort_id, ''), round_no);

-- One roster position speaks once per round. Two people who both believe they
-- are "Leader 07" still cannot both submit; the same person can submit again
-- next month, which is the entire point of a round.
DROP INDEX idx_responses_rater;
CREATE UNIQUE INDEX idx_responses_rater
  ON responses (cohort_id, rater_member_id, round_no) WHERE rater_member_id IS NOT NULL;

-- Reports are per round as well, so October's group report does not overwrite
-- September's and the facilitator keeps both links.
DROP INDEX idx_cohort_reports_target;
CREATE UNIQUE INDEX idx_cohort_reports_target
  ON cohort_reports (cohort_id, scope, COALESCE(member_id, ''), round_no);
