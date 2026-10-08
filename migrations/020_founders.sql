-- FOUNDERS SEATS, TIPS and the BUILD GUIDE list (pro/founders.js, pro/tips.js,
-- pro/waitlist.js). Numbered 020: 017 and 018 wait on their own branches, and the runner
-- (pro/db.js migrate) applies every file not yet in schema_migrations, by name.
--
-- founders_seats: the 42 founders seats, one row each, seeded open. Seat numbers here
-- have nothing to do with licences.seat: a founder gets a Pro licence (and its own
-- SEAT 00042 number) only when Pro goes live.
--   class: 'ten' (seats 1 to 10, $1,420 once for ten years of Pro) or 'founder'
--     (seats 11 to 42, $420 a year).
--   status: 'open', 'held' (a checkout is open for it, until held_until), 'committed'
--     (a card is saved for it) or 'released' (kept for the record; the code puts a
--     released seat back to open).
--   hold_token: a random value per hold, so a late answer for an old hold never touches a
--     new one. mandate_ip: the IP address that started the checkout (Stripe's mandate
--     address when Stripe gives one); kept only for a committed seat, cleared when the
--     hold ends. Card numbers are never here: Stripe holds the card.
CREATE TABLE IF NOT EXISTS founders_seats (
  seat INTEGER PRIMARY KEY CHECK (seat BETWEEN 1 AND 42),
  class TEXT NOT NULL CHECK (class IN ('ten', 'founder')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'committed', 'released')),
  held_until INTEGER,
  hold_token TEXT,
  checkout_session_id TEXT,
  stripe_customer_id TEXT,
  setup_intent_id TEXT,
  payment_method_id TEXT,
  card_fingerprint TEXT,
  email TEXT,
  handle TEXT CHECK (handle IS NULL OR (length(handle) BETWEEN 1 AND 15 AND handle NOT GLOB '*[^A-Za-z0-9_]*')),
  mandate_at INTEGER,
  mandate_ip TEXT,
  livemode INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((seat <= 10 AND class = 'ten') OR (seat > 10 AND class = 'founder'))
);
CREATE INDEX IF NOT EXISTS founders_seats_session ON founders_seats (checkout_session_id);
CREATE INDEX IF NOT EXISTS founders_seats_email ON founders_seats (email);
CREATE INDEX IF NOT EXISTS founders_seats_card ON founders_seats (card_fingerprint);

WITH RECURSIVE n(seat) AS (SELECT 1 UNION ALL SELECT seat + 1 FROM n WHERE seat < 42)
INSERT OR IGNORE INTO founders_seats (seat, class, status, created_at, updated_at)
  SELECT seat, CASE WHEN seat <= 10 THEN 'ten' ELSE 'founder' END, 'open',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM n;

-- founders_log: public lines, counts only ("Seat 12 released Nov 3."). Never a name, an
-- email address or a Stripe id.
CREATE TABLE IF NOT EXISTS founders_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 120)
);

-- tips: one row per paid tip (FUEL THE FEED). amount_cents comes from Stripe, never from
-- the browser. fish_name_raw: what the buyer typed (up to 16 characters), for review;
-- fish_name: the name shown, set only when the owner approves it (scripts/fish-review.js).
-- Until then, or after a removal, the fish shows as "Fish #<id>". A fish swims for 365
-- days (expires_at).
CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY,
  checkout_session_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  fish_name_raw TEXT CHECK (fish_name_raw IS NULL OR length(fish_name_raw) <= 16),
  fish_name TEXT CHECK (fish_name IS NULL OR length(fish_name) BETWEEN 2 AND 16),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'removed')),
  livemode INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tips_live ON tips (expires_at);

-- The waitlist (019) takes a second list: source 'guide', the BUILD GUIDE page. One
-- address may be on both lists, so the one-row-per-address rule becomes one row per
-- address and list. SQLite cannot change a CHECK in place: the table is made again with
-- the same columns in the same order, and every row is copied over.
CREATE TABLE waitlist_new (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'pro-soon' CHECK (source IN ('pro-soon', 'guide')),
  notified_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (email, source)
);
INSERT INTO waitlist_new (id, email, created_at, source, notified_at, deleted_at)
  SELECT id, email, created_at, source, notified_at, deleted_at FROM waitlist;
DROP TABLE waitlist;
ALTER TABLE waitlist_new RENAME TO waitlist;
