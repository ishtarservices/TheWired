-- Which of our apps each account uses, so the activity report can tell Wired
-- desktop users from mobile users from external Nostr clients on the relay.
--
-- One row per (pubkey, client, platform). The authContext hook upserts it from
-- the X-Wired-Client request header on authenticated API calls, throttled in
-- memory to one write per pubkey+client per 10 minutes. Deliberately minimal:
-- no request log, no IPs, no user agent -- only what the report needs.
CREATE TABLE IF NOT EXISTS app.account_clients (
    pubkey     TEXT NOT NULL,
    client     TEXT NOT NULL,            -- desktop | mobile | web
    platform   TEXT NOT NULL DEFAULT '', -- macos | windows | linux | ios | android | '' (unknown)
    version    TEXT NOT NULL,            -- last version seen
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pubkey, client, platform)
);
