-- A memorable alias for a cohort's open link.
--
-- The instrument-level aliases (`/influencing`, `/transactionanalysis`) resolve
-- to "the" generic link for an assessment, which only works when there is one.
-- A cohort instrument has one link per cohort, so migration 0010 gave
-- Collaboration Sociometry no short_slug at all — a bare `/sociometry` matched
-- every cohort's link and returned whichever row the database happened to hand
-- back first, dropping whoever typed it into an arbitrary group's exercise.
--
-- The alias therefore belongs to the cohort, not to the instrument:
-- `/acme-leadership-2026` rather than `/sociometry`. It is optional — a cohort
-- without one is reached by its token link exactly as before.
ALTER TABLE cohorts ADD COLUMN short_slug TEXT;

-- Unique where present. A partial index rather than a plain UNIQUE column so
-- that any number of cohorts may have no alias at all.
CREATE UNIQUE INDEX idx_cohorts_short_slug
  ON cohorts (short_slug) WHERE short_slug IS NOT NULL;
