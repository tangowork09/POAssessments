-- Who rates whom, when a cohort is too big for everyone-rates-everyone.
--
-- At sixty people the full matrix is 59 rows of twelve statements per
-- respondent, which nobody finishes. The client instead maps each rater to a
-- handful of targets — one leader rates ten, another three — and the exercise
-- shows each respondent only their assigned colleagues.
--
-- The table is the map. No rows for a cohort means the cohort runs as before:
-- everyone rates everyone. Once any assignment exists for a cohort, a rater
-- WITH rows sees exactly their targets; a rater with NO rows still sees the
-- full roster. That fallback is deliberate: an assignment sheet that covers
-- half the group must not silently lock the other half out of the exercise —
-- being over-shown is recoverable, being locked out is a support call.
--
-- Addressed by member id, not roster position: positions encode answers and
-- never move, ids are what the console edits by. Deleting a member cascades
-- their assignments in both directions.
CREATE TABLE cohort_assignments (
  id                TEXT NOT NULL PRIMARY KEY,
  cohort_id         TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  rater_member_id   TEXT NOT NULL REFERENCES cohort_members(id) ON DELETE CASCADE,
  target_member_id  TEXT NOT NULL REFERENCES cohort_members(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cohort_id, rater_member_id, target_member_id)
);
CREATE INDEX idx_cohort_assignments_rater
  ON cohort_assignments (cohort_id, rater_member_id);
