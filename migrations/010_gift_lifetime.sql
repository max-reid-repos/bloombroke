-- Gift code rows are deleted 12 months after they were used or expired (store.js
-- purgeRecords). A redeemed code must still count toward the licence's 3 for life, so
-- the number of redeemed codes whose rows were deleted is kept on the licence. Additive.
ALTER TABLE licences ADD COLUMN gifts_redeemed_purged INTEGER NOT NULL DEFAULT 0;
