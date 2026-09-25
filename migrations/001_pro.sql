-- Bloombroke Pro: licences, processed Stripe events, synced documents.
-- A licence key is never stored in plain text: only its SHA-256 hash and last 4 characters.
-- reveal_ciphertext holds the full key, AES-256-GCM encrypted with PRO_SECRET, for the
-- 24 hours after checkout in which the success page may show it. It is wiped after that.

CREATE TABLE licences (
  id INTEGER PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  checkout_session_id TEXT UNIQUE,
  status TEXT NOT NULL,
  past_due_since INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reveal_ciphertext TEXT,
  reveal_expires_at INTEGER
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE TABLE sync_docs (
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (licence_id, name)
);
