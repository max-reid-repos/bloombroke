-- FOUNDERS SEATS (pro/founders.js): checkouts that were given back. A finished checkout
-- that got no seat (a second seat for the same email or card, a full class, after the
-- deadline, or a card already taken off) is written here in the same transaction that
-- lets its hold go, before the card and the Stripe customer are removed. A session listed
-- here is never committed later, by a resent event, a late setup_intent.succeeded or the
-- success page. Additive: one new table. 020 is left as it ran.
--
-- reason: 'duplicate' | 'full' | 'ended' | 'gone'. payment_method_id, stripe_customer_id:
-- what is still to be removed at Stripe (a retry removes them again; both calls are
-- idempotent). No email address, no card fingerprint, no IP address.
CREATE TABLE IF NOT EXISTS founders_given_back (
  checkout_session_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('duplicate', 'full', 'ended', 'gone')),
  class TEXT CHECK (class IS NULL OR class IN ('ten', 'founder')),
  payment_method_id TEXT,
  stripe_customer_id TEXT,
  livemode INTEGER,
  at INTEGER NOT NULL
);
