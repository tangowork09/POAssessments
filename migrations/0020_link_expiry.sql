-- Personal links: an expiry, and a copy a facilitator can still read.
--
-- Two problems, one table.
--
-- The link was shown exactly once, at the moment it was minted, because only
-- its hash was kept. That is the stronger position against a leaked database,
-- and it cost the facilitator the one thing the Access tab exists to give
-- them: a link they can send again when somebody says they never got it. The
-- platform already keeps `token_plain` for the generic short-slug links and
-- for report links, so this makes personal links consistent with the rest
-- rather than introducing a new kind of exposure.
--
-- And the links never expired at all. "Valid for two weeks" was how the
-- exercise was described to participants and not something the software did.
-- `expires_at` is the moment a link stops working, NULL meaning it does not.
ALTER TABLE links ADD COLUMN expires_at TEXT;

-- How long a personal link lasts in this cohort, in days. Zero means it never
-- expires, which is a facilitator's decision to make and not one to hide. The
-- default is a fortnight, which is what the instrument's own instructions say.
ALTER TABLE cohorts ADD COLUMN link_ttl_days INTEGER NOT NULL DEFAULT 14;

-- Reading a link by token is the hot path; expiry is checked on every one.
CREATE INDEX IF NOT EXISTS idx_links_expiry ON links (expires_at) WHERE expires_at IS NOT NULL;
