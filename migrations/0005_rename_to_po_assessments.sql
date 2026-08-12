-- The client bought poassessments.com rather than pomotivation.com as the
-- product's sending and access domain (see migration 0003 for why a matching
-- domain matters — DMARC alignment). The displayed brand name follows the
-- domain it now ships under.
--
-- The logo image is untouched: public/logo-po-motivation.png still carries the
-- old wordmark in its pixels, so the header/report/PDF mark visually lags this
-- rename until a replacement asset is supplied.
UPDATE settings SET value = 'PO Assessments', updated_at = datetime('now')
 WHERE key = 'branding.company_name' AND value = 'PO Motivation';
