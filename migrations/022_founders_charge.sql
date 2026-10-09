-- FOUNDERS SEATS charge day (pro/founders.js, scripts/founders.js charge | golive |
-- reconcile | expire-unpaid). Additive only: new columns and one new table, no table is
-- made again, every row stays as it is.
--
-- founders_seats: a seat keeps status 'committed' after the charge (the totals, the
-- public grid and the one-seat-per-person check all read 'committed'); charge_state
-- carries what happened at the charge:
--   NULL        not charged yet
--   'charging'  a PaymentIntent exists (payment_intent_id) and is being confirmed
--   'charged'   paid: licence_id is the Pro licence it got
--   'failed'    the card failed; a pay link (pay_hash) works until pay_expires_at
--   'unpaid'    the pay link ran out; the seat is being given back (release clears it)
-- payment_intent_id: the charge-day PaymentIntent, or the pay-link one once paid.
-- subscription_id: the founder seat's yearly renewal, made at go-live.
-- licence_id: licences.id (no foreign key: the licence record rules are their own).
-- fail_code: Stripe's decline or error code only, never a message.
-- pay_hash, claim_hash: SHA-256 of the pay and claim link tokens; the tokens themselves
-- are never stored. pay_session_id: the pay link's Checkout Session. pay_revealed_at:
-- when the pay-link success page showed a key (once).
ALTER TABLE founders_seats ADD COLUMN charge_state TEXT CHECK (charge_state IS NULL OR charge_state IN ('charging', 'charged', 'failed', 'unpaid'));
ALTER TABLE founders_seats ADD COLUMN payment_intent_id TEXT;
ALTER TABLE founders_seats ADD COLUMN subscription_id TEXT;
ALTER TABLE founders_seats ADD COLUMN licence_id INTEGER;
ALTER TABLE founders_seats ADD COLUMN charged_at INTEGER;
ALTER TABLE founders_seats ADD COLUMN fail_code TEXT;
ALTER TABLE founders_seats ADD COLUMN pay_hash TEXT;
ALTER TABLE founders_seats ADD COLUMN pay_expires_at INTEGER;
ALTER TABLE founders_seats ADD COLUMN pay_session_id TEXT;
ALTER TABLE founders_seats ADD COLUMN pay_revealed_at INTEGER;
ALTER TABLE founders_seats ADD COLUMN claim_hash TEXT;
ALTER TABLE founders_seats ADD COLUMN claim_expires_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS founders_seats_pay_hash ON founders_seats (pay_hash);
CREATE UNIQUE INDEX IF NOT EXISTS founders_seats_claim_hash ON founders_seats (claim_hash);
CREATE INDEX IF NOT EXISTS founders_seats_pay_session ON founders_seats (pay_session_id);

-- licences: a founders licence has no subscription of its own until go-live (a founder
-- seat) or ever (a five-year seat). term_ends_at: the last moment of a five-year seat's
-- Pro (go-live + 5 years); NULL means no end set. A daily sweep (pro/index.js) moves an
-- ended term licence to 'canceled'.
ALTER TABLE licences ADD COLUMN term_ends_at INTEGER;

-- founders_state: one row per mode (livemode 1 live, 0 test). frozen_at: seats closed
-- for the charge (durable: the server and the checkout read it). charge_started_at: the
-- first charge run. golive_at: the day Pro goes live (start of that day, UTC).
CREATE TABLE IF NOT EXISTS founders_state (
  livemode INTEGER PRIMARY KEY CHECK (livemode IN (0, 1)),
  frozen_at INTEGER,
  charge_started_at INTEGER,
  golive_at INTEGER
);
