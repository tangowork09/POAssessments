-- Tells an invitation apart from a continuation link.
--
-- A personal link is created in two entirely different circumstances. A
-- facilitator issues one to a named person: that is an invitation, and it is
-- the denominator of "47 of 50 answered". A respondent arriving on a shared
-- link is also given one, so they can close the tab and come back to their own
-- half-finished sheet: that is a continuation, and it is not evidence that
-- anybody was invited to anything.
--
-- Counting both made a run answered through one shared link report that it had
-- invited exactly as many people as had answered — a response rate of 100%,
-- always, no matter how many leaders never opened it. The number was not
-- wrong by a little; it was a restatement of the numerator.
ALTER TABLE links ADD COLUMN self_issued INTEGER NOT NULL DEFAULT 0;

-- Nothing existing is back-filled to 1. The two instruments shipped before this
-- hand out continuation links on a generic link as well, but their turnout is
-- not read from this column, and guessing which historical rows were
-- self-issued would put invented facts in the audit trail.
