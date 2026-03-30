-- Discovery system: listing requests, categories, relay directory

-- Listing requests (request/confirm flow for space directory)
CREATE TABLE IF NOT EXISTS app.listing_requests (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    requester_pubkey TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    category TEXT,
    tags TEXT[],
    reason TEXT,
    reviewer_pubkey TEXT,
    review_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_listing_requests_status ON app.listing_requests(status);
CREATE INDEX IF NOT EXISTS idx_listing_requests_space ON app.listing_requests(space_id);

-- Space categories for organizing discovery
CREATE TABLE IF NOT EXISTS app.space_categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO app.space_categories (slug, name, description, icon, position)
VALUES
  ('gaming', 'Gaming', 'Game communities and discussions', 'Gamepad2', 0),
  ('technology', 'Technology', 'Tech, programming, and engineering', 'Cpu', 1),
  ('music', 'Music', 'Music communities and discussions', 'Music', 2),
  ('art', 'Art & Design', 'Art, design, and creative communities', 'Palette', 3),
  ('social', 'Social', 'General social communities', 'Users', 4),
  ('education', 'Education', 'Learning and educational communities', 'GraduationCap', 5),
  ('news', 'News & Media', 'News, journalism, and media', 'Newspaper', 6),
  ('crypto', 'Crypto & Bitcoin', 'Cryptocurrency and Bitcoin communities', 'Bitcoin', 7),
  ('sports', 'Sports', 'Sports communities and discussions', 'Trophy', 8),
  ('nostr', 'Nostr', 'Nostr protocol and ecosystem', 'Zap', 9),
  ('other', 'Other', 'Everything else', 'MoreHorizontal', 10)
ON CONFLICT (slug) DO NOTHING;

-- Relay directory (NIP-66 + NIP-11 cached data)
CREATE TABLE IF NOT EXISTS app.relay_directory (
    url TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    pubkey TEXT,
    supported_nips INTEGER[],
    software TEXT,
    version TEXT,
    country_code TEXT,
    is_paid BOOLEAN DEFAULT FALSE,
    requires_auth BOOLEAN DEFAULT FALSE,
    rtt_ms INTEGER,
    user_count INTEGER DEFAULT 0,
    last_seen_online TIMESTAMPTZ,
    last_checked TIMESTAMPTZ,
    nip11_json TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_relay_directory_user_count ON app.relay_directory(user_count DESC);

-- Add discovery columns to spaces table
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ;
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS discovery_score INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_spaces_listed ON app.spaces(listed) WHERE listed = TRUE;
CREATE INDEX IF NOT EXISTS idx_spaces_discovery_score ON app.spaces(discovery_score DESC) WHERE listed = TRUE;
CREATE INDEX IF NOT EXISTS idx_spaces_category ON app.spaces(category);
