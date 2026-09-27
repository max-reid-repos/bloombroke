-- Seat numbers, the billing interval, gift months and gift codes. Additive only: new
-- columns, one new table, and a backfill of the new seat column.

-- A seat number: shown as SEAT 00042, display only, never a credential. Licences made
-- before this get seats in the order they were made (created_at, then id); a new
-- licence gets the next number (store.js). Seats are never reused.
ALTER TABLE licences ADD COLUMN seat INTEGER;
UPDATE licences SET seat = (
  SELECT r.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM licences) r WHERE r.id = licences.id
) WHERE seat IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS licences_seat ON licences(seat);

-- month or year, read from Stripe with each status update. NULL when unknown.
ALTER TABLE licences ADD COLUMN billing_interval TEXT;

-- A licence made from a gift code: free Pro until this time (ms), no card, no
-- subscription. NULL for every other licence, and cleared if the licence later
-- subscribes (REACTIVATE).
ALTER TABLE licences ADD COLUMN gift_expires_at INTEGER;

-- Gift codes. Like licence keys, a code is never stored in plain text: only its SHA-256
-- hash and last 4 characters. A code works once, and only until expires_at.
CREATE TABLE gift_codes (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  giver_licence_id INTEGER NOT NULL REFERENCES licences(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_licence_id INTEGER UNIQUE REFERENCES licences(id)
);
CREATE INDEX gift_codes_giver ON gift_codes(giver_licence_id);
