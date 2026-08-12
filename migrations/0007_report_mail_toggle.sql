-- Per-assessment control over automatic report delivery.
--
-- Default 1 (on) preserves today's behaviour exactly: finishing an assessment
-- scores it, stores the report and emails it. With auto_send_report = 0 the
-- first two still happen — the candidate's report is generated and openable by
-- its link — only the email is withheld, so an administrator can review before
-- anything reaches the candidate.
ALTER TABLE assessments ADD COLUMN auto_send_report INTEGER NOT NULL DEFAULT 1;

-- When the report email actually went out. NULL means "not sent yet", which is
-- what the admin console's one-click send acts on. Recorded on the report row
-- rather than the response because it is a fact about the delivered artefact,
-- and it makes "generated but unsent" a single-column query.
ALTER TABLE reports ADD COLUMN sent_at TEXT;

-- Existing reports all predate the toggle and were auto-sent on completion, so
-- backfilling them as sent keeps the console from offering to re-send mail the
-- candidate already has.
UPDATE reports SET sent_at = created_at WHERE sent_at IS NULL;
