-- GRAVEYARD: F to pay respects. A ticker and a total, nothing else: no IP address, no
-- browser id, no time, nothing about a person. Additive: one new table, IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS respects (
  ticker TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
