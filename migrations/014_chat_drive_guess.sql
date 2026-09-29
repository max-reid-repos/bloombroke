-- CHAT upgrades: DRIVE system lines and the GUESS LEAGUE. Additive only: one new column
-- and two new tables. DRIVE itself keeps nothing here: who drives and the screens sent
-- live in memory only (pro/chat.js createDrives); only the "is driving" and "stopped"
-- lines are messages.
-- Retention (pro/chat-store.js purge): results and week marks go after 30 days, like
-- messages, and every row of a licence 30 days after its Pro ends.

-- kind: NULL for a message someone wrote, 'sys' for a line the server posts (licence_id
-- NULL: "Tom 1 is driving."), 'guess' for a GUESS result a member posted.
ALTER TABLE chat_messages ADD COLUMN kind TEXT;

-- A GUESS result posted to a room: one per licence per room per puzzle. The score is the
-- server's own replay of the guesses (data/guess.js verifyPlay), never a number the page
-- sends. day: the puzzle's New York date. points: 7 minus the tries when solved, else 0.
CREATE TABLE chat_guess (
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  day TEXT NOT NULL,
  tries INTEGER NOT NULL,
  solved INTEGER NOT NULL,
  points INTEGER NOT NULL,
  message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, licence_id, n)
);
CREATE INDEX chat_guess_room_day ON chat_guess(room_id, day);
CREATE INDEX chat_guess_created ON chat_guess(created_at);
CREATE INDEX chat_guess_licence ON chat_guess(licence_id);
CREATE INDEX chat_guess_message ON chat_guess(message_id);

-- The weekly winner line, posted once per room per week (week: its Monday, New York).
CREATE TABLE chat_guess_weeks (
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, week)
);
CREATE INDEX chat_guess_weeks_created ON chat_guess_weeks(created_at);
