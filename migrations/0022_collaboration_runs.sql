-- Runs, anonymity and segments for the Collaboration Diagnostic.
--
-- A run of this instrument is one organisation, diagnosed at one point in time,
-- by around fifty of its leaders. That is the same shape a cohort already has,
-- and a re-diagnosis six months later is the same shape a round already has, so
-- neither concept is rebuilt here. A Collaboration Diagnostic run IS a cohort
-- whose `assessment_id` is the diagnostic, and a wave IS one of its rounds.
--
-- What the existing cohort machinery assumes and this instrument does not need:
--
--   * A roster. Sociometry cannot start without one — you cannot rate people
--     who are not listed. Here the roster is a convenience for inviting and for
--     segmenting, and a run answered entirely through one shared link with no
--     named members is legitimate. So `cohort_members` simply stays empty, and
--     the columns that serve the matrix (`rater_member_id`, `min_raters`,
--     `tie_threshold`, `min_rated_targets`) stay NULL or keep their defaults
--     and are never read for this instrument.
--
-- What it needs and the cohort machinery does not have: a confidentiality floor
-- for segment reporting, real anonymity as a storage property rather than a
-- promise, and somewhere to keep the department a respondent belongs to.

-- ------------------------------------------------------------ the floor
--
-- Fewest respondents in a segment before that segment is reported on. Below it,
-- a departmental mean is close enough to a quotation to identify who said what,
-- which breaks the confidentiality the diagnostic was answered under. Per
-- cohort because it is the number a client will want to argue about; five is
-- the default and the console says when a segment is withheld rather than
-- leaving a blank cell.
ALTER TABLE cohorts ADD COLUMN min_segment INTEGER NOT NULL DEFAULT 5;

-- ---------------------------------------------------------- anonymity
--
-- Off by default, because a named run is the simpler promise to keep.
--
-- On, it changes where the answers are stored, not merely what the console
-- draws. A promise of anonymity that is enforced by remembering not to write a
-- query is not a promise; the first person with database access breaks it
-- without meaning to.
ALTER TABLE cohorts ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;

-- Set on the response at submission, never inferred later from the cohort: a
-- facilitator who switches the cohort flag afterwards must not retroactively
-- change what was promised to people who have already answered.
ALTER TABLE responses ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;

-- An anonymous response is detached from the person who gave it. It is pointed
-- at a placeholder candidate belonging to the round rather than at the leader,
-- so the row itself carries no identity to join back to. Which means many
-- responses now share one candidate id, and the identity index — one response
-- per person per instrument per cohort per round — would refuse the second
-- anonymous submission. It becomes partial: it still guards named responses
-- exactly as before, and simply does not apply where there is no identity to
-- guard. Double submission in an anonymous run is prevented by the link
-- instead, which is single-use and knows nothing about who holds it.
DROP INDEX idx_responses_identity;
CREATE UNIQUE INDEX idx_responses_identity
  ON responses (assessment_id, candidate_id, COALESCE(cohort_id, ''), round_no)
  WHERE anonymous = 0;
CREATE INDEX idx_responses_anonymous
  ON responses (cohort_id, round_no) WHERE anonymous = 1;

-- ------------------------------------------------------------ segments
--
-- The cuts a run collects, declared per cohort before anyone is invited.
--
-- Options are a fixed list rather than a free-text box on purpose. Free text
-- destroys the very thing it is collected for: "Ops", "ops", "Operations" and
-- "Operations " are four departments to a GROUP BY and one department to the
-- organisation, and no amount of cleaning afterwards recovers which leader
-- meant which. A respondent picks; a facilitator maintains the list.
CREATE TABLE cohort_facets (
  cohort_id  TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  -- 'department', 'function', 'level', 'tenure' — the console's own keys.
  key        TEXT NOT NULL,
  -- What the respondent is asked, in the facilitator's words.
  label      TEXT NOT NULL,
  -- JSON array of the allowed values, in the order they are offered.
  options    TEXT NOT NULL,
  -- A facet the respondent may decline. An optional facet that is skipped is
  -- absent below rather than stored as 'Not given', so a suppressed segment and
  -- an unanswered one never pool into a phantom department.
  required   INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cohort_id, key)
);

-- What one respondent answered for those facets.
--
-- This lives on the response, not on the candidate, and that is the point: in
-- an anonymous run the response has no candidate, and the department still has
-- to travel with the answers or there is nothing to cut by. It is also the
-- reason segments are only ever reported above the floor — department plus
-- level plus tenure is, at fifty people, frequently a description of one
-- person.
CREATE TABLE response_facets (
  response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (response_id, key)
);
CREATE INDEX idx_response_facets_key ON response_facets (key, value);
