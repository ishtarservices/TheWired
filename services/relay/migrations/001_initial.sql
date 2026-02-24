-- Relay schema for NIP-29 relay
CREATE SCHEMA IF NOT EXISTS relay;

-- Core event storage
CREATE TABLE IF NOT EXISTS relay.events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    kind INTEGER NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]',
    content TEXT NOT NULL DEFAULT '',
    sig TEXT NOT NULL,
    d_tag TEXT,
    h_tag TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_tsv TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', content)
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_events_kind_created ON relay.events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind ON relay.events (pubkey, kind);
CREATE INDEX IF NOT EXISTS idx_events_htag_kind ON relay.events (h_tag, kind) WHERE h_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_dtag ON relay.events (pubkey, kind, d_tag) WHERE d_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tags ON relay.events USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_events_created ON relay.events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_search ON relay.events USING GIN (search_tsv);

-- Unique constraint for replaceable events (kinds 0, 3, 10000-19999)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_replaceable ON relay.events (pubkey, kind)
    WHERE (kind = 0 OR kind = 3 OR (kind >= 10000 AND kind < 20000));

-- Unique constraint for addressable events (kinds 30000-39999)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_addressable ON relay.events (pubkey, kind, d_tag)
    WHERE (kind >= 30000 AND kind < 40000) AND d_tag IS NOT NULL;

-- NIP-29 group state
CREATE TABLE IF NOT EXISTS relay.groups (
    group_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    picture TEXT,
    about TEXT,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Group members
CREATE TABLE IF NOT EXISTS relay.group_members (
    group_id TEXT NOT NULL REFERENCES relay.groups(group_id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, pubkey)
);

-- Group roles (admin, moderator, etc.)
CREATE TABLE IF NOT EXISTS relay.group_roles (
    group_id TEXT NOT NULL REFERENCES relay.groups(group_id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, pubkey, role)
);

-- Invite codes (NIP-29 kind:9009)
CREATE TABLE IF NOT EXISTS relay.invite_codes (
    code TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES relay.groups(group_id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_group ON relay.invite_codes (group_id);
