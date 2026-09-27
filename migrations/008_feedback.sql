-- FEEDBACK: notes people send from the terminal. No IP address and no licence are
-- stored with a note. email is only there if the sender typed one to get a reply.
-- Kept up to 12 months (pro/feedback.js prunes older rows).
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  screen TEXT,
  legal_version TEXT
);
CREATE INDEX feedback_created ON feedback(created_at);
