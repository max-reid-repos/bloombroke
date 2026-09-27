-- Licence rows can now be deleted (5 years after the licence ends, store.js purgeRecords),
-- so the next seat can no longer come from MAX(seat) alone: that could hand out the
-- seat of a deleted licence again. seat_high keeps the highest seat ever given, and a
-- trigger raises it with every new licence. Additive: one table, one row, one trigger.
CREATE TABLE seat_high (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL);
INSERT INTO seat_high (id, n) SELECT 1, COALESCE(MAX(seat), 0) FROM licences;
CREATE TRIGGER licences_seat_high AFTER INSERT ON licences WHEN NEW.seat IS NOT NULL BEGIN
  UPDATE seat_high SET n = MAX(n, NEW.seat) WHERE id = 1;
END;
