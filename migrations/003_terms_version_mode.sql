-- Which Terms the buyer accepted (TERMS_VERSION at the time), and whether the licence
-- came from a live or a test (demo) checkout: 1 live, 0 test, NULL unknown.
ALTER TABLE licences ADD COLUMN terms_version TEXT;
ALTER TABLE licences ADD COLUMN livemode INTEGER;
