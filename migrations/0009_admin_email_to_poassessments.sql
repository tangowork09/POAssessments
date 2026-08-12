-- The seeded superadmin's login moves to the domain the platform actually runs
-- and sends from. Changing ADMIN_EMAIL alone would not do this: bootstrap.ts
-- seeds an administrator only when admin_users is empty, so an account that
-- already exists keeps its old address forever.
--
-- Scoped by the old address rather than applied blindly, so it is a no-op on
-- any database seeded with a different admin (local development uses
-- admin@example.com) and cannot rewrite an unrelated account.
--
-- The password hash is untouched: the same password logs in at the new address.
UPDATE admin_users
   SET email = 'admin@poassessments.com'
 WHERE email = 'admin@pomotivation.com';
