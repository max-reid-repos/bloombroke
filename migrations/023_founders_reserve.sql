-- FOUNDERS RESERVATIONS (pro/founders.js POST /api/founders/reserve): on the founders
-- page, someone not ready to save a card can leave an email address. It holds no seat.
-- It is kept in the waitlist (019, 020) as a third list: source 'founders'. We write to
-- it about the founders seats, and delete it 30 days after the founders deadline
-- (Privacy Policy, "Founders email list").
--
-- SQLite cannot change a CHECK in place: as in 020, the table is made again with the
-- same columns in the same order, UNIQUE (email, source) kept, and every row copied over.
CREATE TABLE waitlist_new (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'pro-soon' CHECK (source IN ('pro-soon', 'guide', 'founders')),
  notified_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (email, source)
);
INSERT INTO waitlist_new (id, email, created_at, source, notified_at, deleted_at)
  SELECT id, email, created_at, source, notified_at, deleted_at FROM waitlist;
DROP TABLE waitlist;
ALTER TABLE waitlist_new RENAME TO waitlist;
