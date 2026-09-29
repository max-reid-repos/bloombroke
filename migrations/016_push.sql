-- PINGS: Web Push for Pro (pro/push.js). Additive only: three new tables and their
-- indexes. Rows point at the internal licence id and cascade with it, so the 5-year
-- licence record purge is never blocked by a push row.
-- Retention (pro/push.js purge, at boot and daily): every push row of a licence goes 30
-- days after its Pro ended, or at once on DELETE MY ACCOUNT; subscriptions also go on
-- NEW KEY, on LOG OUT or pings off on that device, and when the push service says the
-- subscription is gone (404, 410) or after 5 failed sends in a row.

-- One row a browser that turned pings on: the push service URL (endpoint) and the
-- browser's public keys for the end-to-end encryption (p256dh, auth).
CREATE TABLE push_subs (
  id INTEGER PRIMARY KEY,
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subs_licence ON push_subs(licence_id);

-- What to ping about, per licence (every device of it): CHAT messages, closed-tab
-- ALERTS, and whether a chat ping may show the message text (off: "Open CHAT to read it.").
CREATE TABLE push_prefs (
  licence_id INTEGER PRIMARY KEY REFERENCES licences(id) ON DELETE CASCADE,
  chat INTEGER NOT NULL DEFAULT 0 CHECK (chat IN (0, 1)),
  alerts INTEGER NOT NULL DEFAULT 0 CHECK (alerts IN (0, 1)),
  show_text INTEGER NOT NULL DEFAULT 0 CHECK (show_text IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- The price alerts of a licence, copied from the browser (public/alerts.js) while
-- closed-tab alerts are on, so the server can check them with the tab closed.
-- client_id: the alert's id in the browser. op: the ALERTS operators. dp: the decimals
-- the ping shows. armed: 1 fires when the condition is true; 0 waits until it is false
-- first (a re-armed alert fires on a fresh crossing only). fired_at: set once, when it fired.
CREATE TABLE server_alerts (
  id INTEGER PRIMARY KEY,
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('>', '<', '>=', '<=')),
  level REAL NOT NULL,
  dp INTEGER NOT NULL DEFAULT 2 CHECK (dp BETWEEN 0 AND 8),
  armed INTEGER NOT NULL DEFAULT 1 CHECK (armed IN (0, 1)),
  created_at INTEGER NOT NULL,
  fired_at INTEGER
);
CREATE INDEX server_alerts_licence ON server_alerts(licence_id);
CREATE INDEX server_alerts_waiting ON server_alerts(fired_at, symbol);
