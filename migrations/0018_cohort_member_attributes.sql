-- Two facts about a roster member that the network can be read *through*.
--
-- A sociometry picture answers "who is central here". The first question a
-- facilitator asks of that picture is "central compared to whom" — and the two
-- comparisons that come up in every debrief are how long someone has been in
-- the organisation and where they sit on the formal chart. A newcomer with
-- twelve incoming ties is a different finding from a fifteen-year veteran with
-- twelve; an informal hub two levels below the person everyone formally
-- reports to is the finding the client came for.
--
-- Both are optional and both stay optional. The instrument does not need them
-- to score, no report is withheld without them, and a facilitator who has only
-- a list of names must be able to run the exercise exactly as before. NULL is
-- therefore a first-class value everywhere and means "not recorded" — never
-- "zero", never "unknown band", never "top of the tree by omission".

-- One of '<1y', '1-3y', '3-7y', '7y+'. Deliberately banded rather than a hire
-- date: a band is what a facilitator can fill in from memory for thirty people
-- in one sitting, and it is the only granularity the reading ever uses. Not a
-- CHECK constraint — the set is a product decision that will be revisited with
-- clients, and re-banding behind a CHECK means a table rebuild in SQLite while
-- the app-level enum is one edit. Validation lives in validation.ts.
ALTER TABLE cohort_members ADD COLUMN tenure_band TEXT;

-- The roster `no` of this member's manager *within this cohort*, or NULL for
-- not recorded / top of the tree. A position rather than a member id, matching
-- the rest of the instrument: positions are the addresses ratings point at and
-- never move, so a formal line drawn against one survives a rename and every
-- round. It is not a foreign key — SQLite cannot express "references a `no` in
-- my own cohort", and a real FK on member id would either cascade a manager's
-- removal into the rows of everyone under them or block the removal outright.
-- Neither is right: taking a manager off the roster should leave their reports
-- on it, pointing at a position that is now vacant, which reads correctly as
-- "their line went with them". The route checks the position exists on the
-- cohort at write time; every reader treats a dangling one as not recorded.
ALTER TABLE cohort_members ADD COLUMN reports_to INTEGER;
