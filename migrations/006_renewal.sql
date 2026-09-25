-- What Stripe says about renewal, read fresh with each status update: whether the
-- subscription ends at the period end (cancelled, will not renew), when the paid period
-- ends, and a set cancel date if any. Times in milliseconds.
ALTER TABLE licences ADD COLUMN cancel_at_period_end INTEGER;
ALTER TABLE licences ADD COLUMN current_period_end INTEGER;
ALTER TABLE licences ADD COLUMN cancel_at INTEGER;
