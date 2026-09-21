-- What a run needs once somebody is actually running one.
--
-- Everything here comes from the same place: a facilitator does not sit in the
-- console while a wave is open. They set it up on Monday, and the next three
-- weeks happen without them. Anything that requires them to remember a date or
-- press a button on a particular afternoon will be the thing that does not
-- happen.

-- ----------------------------------------------------------- closing itself
--
-- The date the wave stops accepting answers. Reached, the wave closes exactly
-- as if the facilitator had pressed Close: participant sheets are built and
-- sent if the run shares them. NULL means it closes only by hand, which stays
-- the default — a deadline nobody set is a deadline nobody agreed to.
ALTER TABLE cohorts ADD COLUMN closes_at TEXT;

-- ------------------------------------------------------- chasing by itself
--
-- Days after a person was invited at which they are reminded, as a JSON array
-- of whole numbers: [3, 7] is "nudge on day three, again on day seven". Empty
-- means the facilitator chases by hand. Reminders only ever go to people who
-- have not finished, and each offset fires once per person.
ALTER TABLE cohorts ADD COLUMN reminder_days TEXT NOT NULL DEFAULT '';

-- Which offsets have already fired for this person, so a scheduler that runs
-- every hour sends one reminder rather than twenty-four.
ALTER TABLE links ADD COLUMN reminded_days TEXT NOT NULL DEFAULT '';

-- ------------------------------------------------------------- tidying up
--
-- Archived runs leave the list without being destroyed. A run holds answers
-- people gave under a promise; deleting it to tidy a screen is not a decision
-- a console should make easy. Runs with no responses at all can still be
-- deleted outright — those are typos, not data.
ALTER TABLE cohorts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- --------------------------------------------------------- the one question
--
-- An optional free-text question, asked after the 24 statements. It is not
-- part of the instrument, is never scored, and never enters a mean: the
-- master copy has 24 statements and this is not a 25th. It exists because the
-- sentence somebody types here is what gets quoted in the debrief.
--
-- Empty means not asked, which is the default.
ALTER TABLE cohorts ADD COLUMN open_question TEXT NOT NULL DEFAULT '';

CREATE TABLE collab_open_answers (
  response_id TEXT PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  cohort_id   TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  round_no    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_collab_open_wave ON collab_open_answers (cohort_id, round_no);

-- ------------------------------------------------------- comparing clients
--
-- Whether this organisation's figures may be counted in a benchmark shown to
-- other clients. Off by default and per run, because it is the organisation's
-- decision and not the consultancy's: a client who answered a confidential
-- diagnostic did not thereby agree to become a line in somebody else's report.
--
-- The benchmark itself reports no organisation by name and is withheld unless
-- several have opted in; see collab-benchmark.ts for the floor.
ALTER TABLE cohorts ADD COLUMN benchmark_opt_in INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------ the facilitator's read
--
-- What the person running the debrief wants to say about a section, printed
-- in the report under that section's figures. The numbers say what happened;
-- this is where somebody says what they think it means, which is the half a
-- client is actually paying for.
CREATE TABLE collab_notes (
  cohort_id   TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  round_no    INTEGER NOT NULL,
  -- A section key, or '' for the note that opens the report.
  section_key TEXT NOT NULL,
  note        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cohort_id, round_no, section_key)
);
