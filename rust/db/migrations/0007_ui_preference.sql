-- Interface preferences, moved out of the browser's localStorage.
--
-- They were persisted by zustand into localStorage, which Chromium keys by
-- ORIGIN — and the origin includes the port. The server binds 127.0.0.1:0 so
-- the OS picks a fresh port every launch (deliberately: ADR-036 wants a port
-- that is not guessable across launches and an app that cannot fail to start
-- because something else holds a number). Each launch therefore opened a new,
-- empty store. 58 of them had accumulated by 2026-08-14, one per launch, each
-- holding the settings of the session that wrote it.
--
-- The write was always correct; only the read looked somewhere new. Hidden
-- accounts were the only VISIBLE symptom because the other five settings reset
-- to values that happened to match the owner's choices — the default theme is
-- the one they had picked, so the reset was invisible.
--
-- Key/value rather than a typed column per setting, because this is the exact
-- shape of the `StateStorage` interface zustand persists through
-- (getItem/setItem/removeItem on a string key), so the adapter is a direct
-- mapping with nothing to keep in step as settings are added.
CREATE TABLE IF NOT EXISTS "UiPreference" (
    "key"       TEXT PRIMARY KEY NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
