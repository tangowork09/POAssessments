-- The participant's own sheet: "your answers against the group".
--
-- Kept in its own table rather than in `reports`. That table is read by the
-- candidate export, by the admin grid and by the two live instruments' report
-- delivery, all of which expect a `scores_json` they know how to parse. Adding
-- a fourth shape to it would put a new instrument's payload in front of code
-- that has been scoring self-ratings in production since August, for no gain:
-- nothing here needs to share a row with those.
--
-- A sheet exists only where the facilitator chose to share one, and only for a
-- named run. An anonymous run has nobody to send it to: that is the trade the
-- organisation made when it promised anonymity, and it is stated on the
-- toggle rather than discovered when the emails do not arrive.
CREATE TABLE collab_participant_sheets (
  id          TEXT PRIMARY KEY,
  -- One sheet per response. Regenerating replaces it, so a sheet can never
  -- disagree with the wave it was built from.
  response_id TEXT NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  cohort_id   TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  round_no    INTEGER NOT NULL,
  -- Only a keyed hash, like every other token in this schema: a database copy
  -- cannot be turned back into a working link.
  token_hash  TEXT NOT NULL UNIQUE,
  -- The figures the sheet is drawn from, not the drawing. Every other report
  -- in this schema re-renders from stored numbers on each request, so a
  -- regenerated document can never disagree with the code that draws it, and
  -- a layout fix reaches sheets that were already sent.
  sheet_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);
CREATE INDEX idx_collab_sheets_wave ON collab_participant_sheets (cohort_id, round_no);
