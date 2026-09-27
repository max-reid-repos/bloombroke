-- BBRK: the site's own numbers, as totals per day. Only a day, a counter name and a
-- count: no IP address, no licence, no browser id, nothing about a person.
-- day is the New York date (YYYY-MM-DD). Additive: one new table, IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
