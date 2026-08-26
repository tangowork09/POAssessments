-- Cohort aliases move under the instrument, and either alias can be switched off.
--
-- 0011 gave a cohort its own alias at the root: `/acme-leadership-2026`. That
-- put a client's group name in the same namespace as the instrument aliases
-- (`/influencing`), where the two can collide and where a reader cannot tell
-- from the link what kind of thing it opens. The alias is now namespaced by the
-- instrument that owns the cohort — `/sociometry/acme-leadership-2026` — which
-- reads as what it is and cannot collide with anything.
--
-- That namespacing is what makes it safe to give Collaboration Sociometry an
-- alias of its own at last. A bare `/sociometry` still resolves to nothing: the
-- instrument lookup requires `links.cohort_id IS NULL`, and every link a cohort
-- instrument has belongs to a cohort. The slug is here to be the first path
-- segment, not to be a link.
UPDATE assessments
   SET short_slug = 'sociometry'
 WHERE id = 'asm_sociometry' AND short_slug IS NULL;

-- Off switch. A facilitator who shared an alias with the wrong group needs to
-- kill the alias without killing the link itself — rotating the token would
-- invalidate every copy of the token link already sent, and clearing the slug
-- would free the name for someone else to take. `slug_active = 0` keeps the
-- slug reserved and the token link working, and sends the alias to the app's
-- link-not-found page.
ALTER TABLE cohorts ADD COLUMN slug_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assessments ADD COLUMN slug_active INTEGER NOT NULL DEFAULT 1;
