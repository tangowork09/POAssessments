-- Administrator roles.
--
-- Two roles, and the difference between them is exactly one panel:
--
--   superadmin  the developer/owner account seeded from ADMIN_EMAIL. Sees and
--               can change Branding.
--   admin       a client administrator. Everything else is identical; the
--               Branding nav item is hidden and its routes answer 403.
--
-- Any account that already exists at this point was seeded from ADMIN_EMAIL,
-- so it is the owner and becomes superadmin.

ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';

UPDATE admin_users SET role = 'superadmin';
