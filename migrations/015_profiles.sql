-- ME: a username, a name colour and a pixel avatar per licence, in the CHAT profile row
-- (chat_profiles, keyed by licence id; it goes with the licence). Additive: new columns,
-- one new table, new indexes, and the old display name moved over.
-- Retention (pro/chat-store.js): a profile goes 30 days after the Pro ended, or at once
-- when the account is deleted in ME; a released name is locked for 30 days, then its
-- row is deleted.

-- username: 3 to 15 of A-Z a-z 0-9 _, starting with a letter, unique whatever the case
-- (pro/chat.js cleanUsername has every rule). NULL: shown as SEAT 42.
ALTER TABLE chat_profiles ADD COLUMN username TEXT;
-- color: one of the 8 name colours (style.css --name-0 .. --name-7). NULL: the default.
ALTER TABLE chat_profiles ADD COLUMN color INTEGER CHECK (color IS NULL OR color BETWEEN 0 AND 7);
-- avatar: an 8x8 pixel picture as 16 hex characters (64 bits, row by row, the left
-- pixel the high bit). NULL: the initials of the username or the seat.
ALTER TABLE chat_profiles ADD COLUMN avatar TEXT CHECK (avatar IS NULL OR (length(avatar) = 16 AND avatar NOT GLOB '*[^0-9a-f]*'));
-- Name changes: 3 a day. name_window: when the current 24 hours began (ms).
ALTER TABLE chat_profiles ADD COLUMN name_changes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_profiles ADD COLUMN name_window INTEGER;

-- The old display name becomes the username only when it passes the new rules and no
-- other licence has the same name in any case. Everything else is dropped: that seat
-- shows as SEAT 42 until it picks a username in ME. Reserved words and bad words are
-- checked again in code at start-up (chat-store.js sweepNames).
UPDATE chat_profiles SET username = name
  WHERE name IS NOT NULL
    AND length(name) BETWEEN 3 AND 15
    AND name GLOB '[A-Za-z]*'
    AND name NOT GLOB '*[^A-Za-z0-9_]*'
    AND lower(name) NOT IN ('admin', 'support', 'bloombroke', 'staff', 'mod', 'pro', 'chat', 'seat', 'official', 'root', 'system', 'help', 'me')
    AND lower(name) NOT GLOB 'bb[0-9]*'
    AND NOT EXISTS (SELECT 1 FROM chat_profiles o WHERE o.licence_id != chat_profiles.licence_id AND o.name IS NOT NULL AND lower(o.name) = lower(chat_profiles.name));
UPDATE chat_profiles SET name = NULL;

CREATE UNIQUE INDEX chat_profiles_username ON chat_profiles(lower(username)) WHERE username IS NOT NULL;

-- A username given up (changed, cleared, the account deleted, the Pro ended long ago):
-- nobody else can take it for 30 days. licence_id: the licence that gave it up, which may
-- take it back (NULL after the account was deleted). Plain rows, no personal data beyond
-- the name.
CREATE TABLE name_releases (
  name_key TEXT NOT NULL,
  licence_id INTEGER REFERENCES licences(id) ON DELETE SET NULL,
  released_at INTEGER NOT NULL
);
CREATE INDEX name_releases_key ON name_releases(name_key, released_at);
CREATE INDEX name_releases_at ON name_releases(released_at);
