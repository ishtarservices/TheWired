-- App schema for backend business logic
CREATE SCHEMA IF NOT EXISTS app;

-- Spaces directory
CREATE TABLE IF NOT EXISTS app.spaces (
    id TEXT PRIMARY KEY,
    host_relay TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    about TEXT,
    category TEXT,
    language TEXT,
    member_count INTEGER NOT NULL DEFAULT 0,
    active_members_24h INTEGER NOT NULL DEFAULT 0,
    messages_last_24h INTEGER NOT NULL DEFAULT 0,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.space_tags (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_space_tags_space ON app.space_tags(space_id);
CREATE INDEX IF NOT EXISTS idx_space_tags_tag ON app.space_tags(tag);

-- Invites
CREATE TABLE IF NOT EXISTS app.invites (
    code TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at BIGINT,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    label TEXT,
    auto_assign_role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Members
CREATE TABLE IF NOT EXISTS app.space_members (
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (space_id, pubkey)
);

CREATE TABLE IF NOT EXISTS app.member_roles (
    space_id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    role_id TEXT NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (space_id, pubkey, role_id)
);

-- Roles & Permissions
CREATE TABLE IF NOT EXISTS app.space_roles (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.role_permissions (
    role_id TEXT NOT NULL REFERENCES app.space_roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS app.channel_overrides (
    role_id TEXT NOT NULL REFERENCES app.space_roles(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    effect TEXT NOT NULL,
    PRIMARY KEY (role_id, channel_id, permission)
);

-- Notifications
CREATE TABLE IF NOT EXISTS app.push_subscriptions (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_pubkey ON app.push_subscriptions(pubkey);

CREATE TABLE IF NOT EXISTS app.notification_queue (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content
CREATE TABLE IF NOT EXISTS app.pinned_messages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    pinned_by TEXT NOT NULL,
    pinned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.scheduled_messages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    content TEXT NOT NULL,
    kind BIGINT NOT NULL DEFAULT 9,
    scheduled_by TEXT NOT NULL,
    scheduled_at BIGINT NOT NULL,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles
CREATE TABLE IF NOT EXISTS app.cached_profiles (
    pubkey TEXT PRIMARY KEY,
    name TEXT,
    display_name TEXT,
    picture TEXT,
    about TEXT,
    nip05 TEXT,
    fetched_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics
CREATE TABLE IF NOT EXISTS app.space_activity_daily (
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    unique_authors INTEGER NOT NULL DEFAULT 0,
    new_members INTEGER NOT NULL DEFAULT 0,
    left_members INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (space_id, date)
);

CREATE TABLE IF NOT EXISTS app.member_engagement (
    space_id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    date TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    reactions_given INTEGER NOT NULL DEFAULT 0,
    reactions_received INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (space_id, pubkey, date)
);

-- Moderation
CREATE TABLE IF NOT EXISTS app.bans (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    reason TEXT,
    banned_by TEXT NOT NULL,
    expires_at BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.timed_mutes (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    channel_id TEXT,
    muted_by TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.spam_reports (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    reporter_pubkey TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.reputation (
    pubkey TEXT PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 100,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Feeds
CREATE TABLE IF NOT EXISTS app.trending_snapshots (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    kind INTEGER,
    event_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trending_period ON app.trending_snapshots(period, score DESC);
