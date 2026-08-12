-- 1. A generic link's plaintext token was previously never retained — only its
--    hash was stored, matching the personal-link design where non-recoverability
--    is the point. A generic link is different: the admin console already
--    describes it as "one open link that anyone can use", so it carries no
--    per-candidate secrecy, and a short WhatsApp-friendly alias needs to resolve
--    to the *current* token on every request (including after a rotation)
--    rather than a token baked into a deploy. Personal links keep token_plain
--    NULL always; only 'generic' rows ever populate it, from here on.
ALTER TABLE links ADD COLUMN token_plain TEXT;

-- 2. Short public aliases for sharing outside email — a slug clean enough to
--    read aloud or type into WhatsApp, distinct from the longer internal slug
--    used elsewhere.
ALTER TABLE assessments ADD COLUMN short_slug TEXT;
UPDATE assessments SET short_slug = 'influencing' WHERE id = 'asm_influencing_style';
UPDATE assessments SET short_slug = 'transactionanalysis' WHERE id = 'asm_ta_ego_states';
UPDATE assessments SET short_slug = 'motivation' WHERE id = 'asm_motivation_need';

-- 3. Full audit trail for mail_outbox: a report cc'd to someone should show up
--    in the send history exactly as it was actually sent.
ALTER TABLE mail_outbox ADD COLUMN cc_email TEXT;
