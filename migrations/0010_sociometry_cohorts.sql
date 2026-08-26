-- Collaboration Sociometry: cohorts, rosters and the peer-rating matrix.
--
-- The two instruments shipped so far are self-ratings: one person answers about
-- themselves, and their report is theirs. Sociometry is a peer network. Every
-- member of an intact leadership group rates every *other* member on twelve
-- statements, and the result only means anything at the level of that whole
-- group. So the platform gains one concept it did not have:
--
--   a COHORT is one run of one instrument on one intact group at one point in
--   time -- "Acme Pharma leadership, September 2026, 32 named leaders".
--
-- A second customer, or the same customer six months later, is a new cohort
-- against the same assessment row. Rosters, links, responses and reports are
-- all scoped to it, so two runs can never pool into one network.
--
-- The rating matrix itself needs no new answer storage. A cell is addressed by
-- its position -- no = (roster position - 1) * 12 + item -- so `answers`,
-- autosave, resume and rate limiting carry a network instrument unchanged. See
-- src/shared/socio.ts for the encoding.

-- ------------------------------------------------------------------ cohorts

CREATE TABLE cohorts (
  id             TEXT PRIMARY KEY,
  assessment_id  TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  organisation   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  -- How many colleagues must have rated someone before that person gets an
  -- individual report. Below it the average is close enough to a quotation
  -- that reporting it would break the confidentiality the exercise was run
  -- under, so the profile is suppressed and says so.
  min_raters     INTEGER NOT NULL DEFAULT 3,
  -- A rating of 4 is "Mostly true": the first point where a respondent asserts
  -- the statement rather than conceding part of it, and therefore where a tie
  -- is drawn in the network. Per-cohort because it is the number most likely
  -- to be revisited with a client.
  tie_threshold  INTEGER NOT NULL DEFAULT 4 CHECK (tie_threshold BETWEEN 1 AND 5),
  -- Fewest colleagues a respondent must rate before they may submit. A blank
  -- row is legitimate -- "we don't really work together" -- so this is a floor
  -- against an empty submission, not a completeness requirement.
  min_rated_targets INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at      TEXT
);
CREATE INDEX idx_cohorts_assessment ON cohorts (assessment_id, status);

-- The roster. `no` is the roster position, 1-based, and it is what the answer
-- encoding addresses -- so it is fixed for the life of the cohort. Removing a
-- member leaves their position vacant rather than renumbering the rest, which
-- would silently reassign every rating already given.
CREATE TABLE cohort_members (
  id         TEXT PRIMARY KEY,
  cohort_id  TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  no         INTEGER NOT NULL,
  name       TEXT NOT NULL,
  function   TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (cohort_id, no)
);
CREATE INDEX idx_cohort_members_cohort ON cohort_members (cohort_id, no);

-- A generic link belongs to a cohort: whoever opens it identifies themselves
-- from that cohort's roster. NULL for the self-rating instruments, which have
-- no cohort.
ALTER TABLE links ADD COLUMN cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE;
CREATE INDEX idx_links_cohort ON links (cohort_id) WHERE cohort_id IS NOT NULL;

-- The generic-link-per-assessment uniqueness has to become per-cohort, or the
-- second cohort of this instrument cannot be issued a link at all.
DROP INDEX idx_links_generic_per_assessment;
CREATE UNIQUE INDEX idx_links_generic_per_assessment
  ON links (assessment_id, COALESCE(cohort_id, '')) WHERE kind = 'generic';

-- ---------------------------------------------------------- responses rebuild
--
-- `responses` carried a table-level UNIQUE (assessment_id, candidate_id): one
-- response per person per instrument. That is right for a self-rating and
-- wrong here -- it would stop the same leader taking part in next year's run of
-- the same instrument, which is exactly the comparison a client will ask for.
-- The constraint becomes (assessment_id, candidate_id, cohort_id), expressed as
-- an index over COALESCE(cohort_id,'') so the NULL cohort of a self-rating
-- still collides with itself the way it always did.
--
-- Dropping a parent table in SQLite performs an implicit DELETE of its rows,
-- and that fires ON DELETE CASCADE on `answers` and `reports` -- every answer
-- and every report in the database. PRAGMA defer_foreign_keys defers the
-- *check*, not the *action*, so it is no protection. The children are
-- therefore staged into unconstrained tables and restored afterwards.

CREATE TABLE _answers_stash AS SELECT * FROM answers;
CREATE TABLE _reports_stash AS SELECT * FROM reports;

CREATE TABLE responses_new (
  id             TEXT PRIMARY KEY,
  assessment_id  TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  link_id        TEXT REFERENCES links(id) ON DELETE SET NULL,
  -- Set for cohort instruments only.
  cohort_id      TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
  -- Which roster position these ratings come *from*. The respondent's own row
  -- is excluded from their matrix, and their ratings are attributed to this
  -- position when the cohort is scored.
  rater_member_id TEXT REFERENCES cohort_members(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','in_progress','completed')),
  answered_count INTEGER NOT NULL DEFAULT 0,
  resume_page    INTEGER NOT NULL DEFAULT 0,
  invited_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  completed_at   TEXT
);

INSERT INTO responses_new
  (id, assessment_id, candidate_id, link_id, cohort_id, rater_member_id,
   status, answered_count, resume_page, invited_at, started_at, completed_at)
SELECT id, assessment_id, candidate_id, link_id, NULL, NULL,
       status, answered_count, resume_page, invited_at, started_at, completed_at
  FROM responses;

DROP TABLE responses;
ALTER TABLE responses_new RENAME TO responses;

DELETE FROM answers;
INSERT INTO answers SELECT * FROM _answers_stash;
DROP TABLE _answers_stash;

DELETE FROM reports;
INSERT INTO reports SELECT * FROM _reports_stash;
DROP TABLE _reports_stash;

CREATE UNIQUE INDEX idx_responses_identity
  ON responses (assessment_id, candidate_id, COALESCE(cohort_id, ''));
CREATE INDEX idx_responses_status ON responses (status);
CREATE INDEX idx_responses_completed ON responses (completed_at);
CREATE INDEX idx_responses_cohort ON responses (cohort_id, status) WHERE cohort_id IS NOT NULL;
-- One roster position speaks once. Without this, two people who both believe
-- they are "Leader 07" would each submit a full matrix and the group would be
-- scored as though one person's opinions were two people's.
CREATE UNIQUE INDEX idx_responses_rater
  ON responses (cohort_id, rater_member_id) WHERE rater_member_id IS NOT NULL;

-- ------------------------------------------------------------ cohort reports
--
-- A sociometry report is not a fact about one response, so it cannot live in
-- `reports` (keyed one-to-one on response_id). There are two scopes: the group
-- report the facilitator reads, and one report per rated member. Both are
-- reached by their own opaque token, hashed the same way a candidate link is.

CREATE TABLE cohort_reports (
  id          TEXT PRIMARY KEY,
  cohort_id   TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('group','member')),
  member_id   TEXT REFERENCES cohort_members(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  -- Retained for the group report only, so the console can re-show the
  -- facilitator's link. Member reports keep this NULL: those are per-person
  -- credentials and are non-recoverable by design.
  token_plain TEXT,
  scores_json TEXT NOT NULL,
  -- True when the member was under the rater floor and their profile was
  -- withheld. The row still exists so the console can show why.
  suppressed  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT,
  CHECK ((scope = 'group' AND member_id IS NULL) OR (scope = 'member' AND member_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_cohort_reports_target
  ON cohort_reports (cohort_id, scope, COALESCE(member_id, ''));
CREATE INDEX idx_cohort_reports_cohort ON cohort_reports (cohort_id, scope);

-- --------------------------------------------------------------- instrument

INSERT INTO assessments
  (id, slug, name, description, status, question_count, per_page,
   min_answer, max_answer, short_slug, auto_send_report)
VALUES
  ('asm_sociometry', 'collaboration-sociometry', 'Collaboration Sociometry',
   'Peer network - power and trust across a leadership group, rated 1-5',
   -- Live, but unreachable without a cohort: the generic link is issued per
   -- cohort rather than by bootstrap, so nothing is open until a facilitator
   -- creates one.
   -- No short_slug. A short alias resolves to "the" generic link for an
   -- assessment, and a cohort instrument has one per cohort — the alias would
   -- drop whoever used it into an arbitrary group.
   'live', 12, 1, 1, 5, NULL,
   -- Off. A group instrument is read by a facilitator before any of it reaches
   -- the people it describes; auto-sending peer feedback the moment the last
   -- response lands is not a defensible default.
   0);

INSERT INTO questions (assessment_id, no, text) VALUES
  ('asm_sociometry', 1,  'When I face a difficult problem, I seek out this person''s judgment, and I find myself adopting their view out of the respect I have for them.'),
  ('asm_sociometry', 2,  'This person can unlock resources, budget, or priority that I depend on.'),
  ('asm_sociometry', 3,  'This person brings people together and builds shared commitment across teams.'),
  ('asm_sociometry', 4,  'To get things moving across departments, this is the person I route them through - and the one I rely on to know what''s really happening across the organisation.'),
  ('asm_sociometry', 5,  'When this person takes a firm position, others here tend to adjust and fall in line with it.'),
  ('asm_sociometry', 6,  'This person can approve or hold up an initiative largely on their own, and their backing or disapproval has real consequences for how things go for people.'),
  ('asm_sociometry', 7,  'This person shapes which issues get attention, often informally and before they reach the room.'),
  ('asm_sociometry', 8,  'I get what I need from this person on time, as promised, and I trust the quality of their work enough to build on it without re-checking.'),
  ('asm_sociometry', 9,  'This person looks out for my interests and the shared goal, and I could admit a mistake or ask them for help without fear it would be used against me.'),
  ('asm_sociometry', 10, 'This person does what they say they will, even when it is inconvenient, and shares information with me openly, including difficult news, early.'),
  ('asm_sociometry', 11, 'Working with this person is straightforward and productive.'),
  ('asm_sociometry', 12, 'I would like more support or cooperation from this person in my work than I currently get.');
