-- CHAT: private messages between Pro seats who added each other. Additive only: new
-- tables and indexes. Rows point at the internal licence id, never at a key.
-- Retention (pro/chat-store.js purge, at boot and daily): messages and requests 30 days,
-- reports 12 months, everything else of a licence 30 days after its Pro ends.
-- Every reference to a licence cascades or is a plain number, so the 5-year licence
-- record purge (store.js purgeRecords) is never blocked by a chat row.

-- The display name a seat picks (max 16 characters). No row: shown as SEAT 42.
CREATE TABLE chat_profiles (
  licence_id INTEGER PRIMARY KEY REFERENCES licences(id) ON DELETE CASCADE,
  name TEXT,
  updated_at INTEGER NOT NULL
);

-- A room is a private chat (dm, two licences) or a small group (up to 8). dm_key is
-- 'low:high' of the two licence ids, so two licences can only ever share one DM.
CREATE TABLE chat_rooms (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
  dm_key TEXT UNIQUE,
  created_by INTEGER REFERENCES licences(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  CHECK ((kind = 'dm') = (dm_key IS NOT NULL))
);

-- Who is in a room. left_at: left the group (no read, no write). from_id: the newest
-- message id when they joined (they see only later ones). last_read_id: read up to here.
CREATE TABLE chat_members (
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  from_id INTEGER NOT NULL DEFAULT 0,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, licence_id)
);
CREATE INDEX chat_members_licence ON chat_members(licence_id);

-- AUTOINCREMENT: an id is never used twice, even after old messages are deleted, so the
-- read marks above stay right.
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  licence_id INTEGER REFERENCES licences(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  card_cmd TEXT,
  card_title TEXT,
  tickers_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_messages_room ON chat_messages(room_id, id);
CREATE INDEX chat_messages_created ON chat_messages(created_at);

-- A request to chat, addressed to a seat number (it may not exist: the sender is never
-- told). closed_at: ignored or blocked, hidden from the recipient until it expires.
CREATE TABLE chat_requests (
  from_licence INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  to_seat INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  PRIMARY KEY (from_licence, to_seat)
);
CREATE INDEX chat_requests_to ON chat_requests(to_seat);

CREATE TABLE chat_blocks (
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  blocked_licence INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (licence_id, blocked_licence)
);

-- A report: who reported, the room, the reported seats and a copy of the last 20
-- messages. Plain numbers, no foreign keys: a report outlives the room it came from.
CREATE TABLE chat_reports (
  id INTEGER PRIMARY KEY,
  reporter INTEGER,
  reporter_seat INTEGER,
  room_id INTEGER,
  reported TEXT NOT NULL,
  reason TEXT,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_reports_created ON chat_reports(created_at);
