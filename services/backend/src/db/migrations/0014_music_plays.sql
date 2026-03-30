-- Durable play tracking for music insights

CREATE TABLE IF NOT EXISTS app.music_play_daily (
    addressable_id TEXT NOT NULL,
    date DATE NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (addressable_id, date)
);

CREATE INDEX IF NOT EXISTS idx_music_play_daily_date ON app.music_play_daily(date);

CREATE TABLE IF NOT EXISTS app.music_play_listeners (
    addressable_id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    first_played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    play_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (addressable_id, pubkey)
);

CREATE INDEX IF NOT EXISTS idx_music_play_listeners_pubkey ON app.music_play_listeners(pubkey);
CREATE INDEX IF NOT EXISTS idx_music_play_listeners_addr ON app.music_play_listeners(addressable_id);
