-- PRO WAITLIST (pro/waitlist.js): while checkout is closed, PRO takes an email address to
-- send one email when Pro opens (Privacy Policy, "Pro waitlist"). Additive only: one new
-- table. Numbered 019 on purpose: 017_google and 018_contact wait on their own branches.
-- The runner (pro/db.js migrate) applies every file not yet in schema_migrations, by
-- name, so those two still run when they land after this one: no collision, no skip.
--
-- email: trimmed and lower case, one row each. created_at: when it was given (ms).
-- source: where it was given; only the PRO screen's "Pro opens soon." for now.
-- notified_at: when the one email was sent (the owner sets it; the list is then deleted).
-- deleted_at: taken off the list without deleting the row; given again, it is back on.
-- A removal on request is a plain DELETE of the row.
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'pro-soon' CHECK (source IN ('pro-soon')),
  notified_at INTEGER,
  deleted_at INTEGER
);
