-- ============================================================================
-- 0015_seed_spaces.sql
-- Seed premade spaces, channels, roles, tags, and feed sources for launch
-- ============================================================================
--
-- PRODUCTION CONFIG (update before deployment):
--   admin_pk  : Replace with your admin hex pubkey
--   host      : Replace with production relay URL (e.g. wss://relay.thewired.app)
--
-- Admin npub: npub1hul73puc28xgpcljywl9lfl9waz9fg27cy38hwn5rqjk7jyd20mqdt95qc
-- ============================================================================

-- ── New Categories ──────────────────────────────────────────────────────────

INSERT INTO app.space_categories (slug, name, description, icon, position) VALUES
  ('culture',   'Culture & Entertainment', 'Pop culture, movies, TV, anime, and entertainment',  'Tv',          11),
  ('history',   'History & Philosophy',    'History, philosophy, and intellectual discourse',     'BookOpen',    12),
  ('lifestyle', 'Lifestyle',               'Fashion, food, travel, and wellness',                'Heart',       13),
  ('politics',  'Politics & Society',      'Political discussion and current affairs',           'Scale',       14),
  ('science',   'Science & Nature',        'Science, space, nature, and environment',            'Microscope',  15),
  ('random',    'Random',                  'General discussion, memes, and everything else',     'Shuffle',     16)
ON CONFLICT (slug) DO NOTHING;

-- ── Seed Spaces ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  -- CONFIGURATION: admin_pk is fixed; host is read from a session GUC so prod
  -- deployments don't bake `ws://localhost:7777` into seed rows. Set it before
  -- running migrations:
  --   SET app.relay_host = 'wss://relay.thewired.app';
  -- (Or pass `-c app.relay_host=...` when invoking psql.) Falls back to
  -- localhost for dev where the GUC isn't set.
  admin_pk TEXT := 'bf3fe8879851cc80e3f223be5fa7e5774454a15ec1227bba7418256f488d53f6';
  host     TEXT := COALESCE(NULLIF(current_setting('app.relay_host', true), ''), 'ws://localhost:7777');

  ts BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

  -- Feed source pubkeys (decoded from npub bech32)
  jack_pk      TEXT := '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
  snowden_pk   TEXT := '84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240';
  fiatjaf_pk   TEXT := '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
  hodlbod_pk   TEXT := '97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322';
  btcmag_pk    TEXT := '59fbee7369df7713dbbfa9bbdb0892c62eba929232615c6ff2787da384cb770f';
  nostrband_pk TEXT := '818a39b5f164235f86254b12ca586efccc1f95e98b45cb1c91c71dc5d9486dda';

BEGIN

  -- ── 1. Spaces ──────────────────────────────────────────────────────────────

  INSERT INTO app.spaces
    (id, host_relay, name, about, category, mode, member_count,  featured, listed, listed_at, discovery_score, creator_pubkey, created_at)
  VALUES
    -- Read-only feed spaces (no chat channels)
    ('seed00000001', host, 'Nostr Highlights',
     'The best content from across the Nostr ecosystem. Protocol updates, community highlights, and decentralized social in action.',
     'nostr', 'read', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed00000002', host, 'Privacy & Freedom',
     'Curated voices on digital privacy, surveillance, and freedom of expression.',
     'news', 'read', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed00000003', host, 'Bitcoin Signal',
     'Bitcoin analysis, market insights, and financial sovereignty — signal over noise.',
     'crypto', 'read', 1, false, true, NOW(), 30, admin_pk, ts),

    ('seed00000004', host, 'Tech Voices',
     'Technology leaders sharing insights on startups, programming, and the future of tech.',
     'technology', 'read', 1, false, true, NOW(), 30, admin_pk, ts),

    ('seed00000005', host, 'The Nostr Dev Feed',
     'Development updates, protocol discussions, and building on Nostr.',
     'nostr', 'read', 1, false, true, NOW(), 30, admin_pk, ts),

    -- Read-write community spaces
    ('seed00000006', host, 'Music Discovery',
     'Share and discover new music across all genres. From underground gems to chart-toppers.',
     'music', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed00000007', host, 'Album Club',
     'Listen, discuss, and review albums together. Weekly picks and deep dives.',
     'music', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000008', host, 'Hip Hop & R&B',
     'The culture. New drops, classics, freestyles, and everything hip hop and R&B.',
     'music', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000009', host, 'Art & Aesthetics',
     'Visual art, digital aesthetics, and creative inspiration. Share your work or find your muse.',
     'art', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed0000000a', host, 'Photography',
     'Photographers sharing their best shots. Landscape, street, portrait — all styles welcome.',
     'art', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed0000000b', host, 'Creative Corner',
     'Drawing, illustration, design, and all things creative. WIPs and finished pieces.',
     'art', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed0000000c', host, 'Gaming Lounge',
     'PC, console, and mobile gaming. News, clips, LFG, and discussion.',
     'gaming', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed0000000d', host, 'Anime & Manga',
     'Anime, manga, and Japanese culture. Seasonal discussions, recommendations, and fan content.',
     'culture', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed0000000e', host, 'Film & Television',
     'Movies, TV shows, streaming, and cinema culture. Reviews, recommendations, and discussion.',
     'culture', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed0000000f', host, 'World History',
     'Exploring the past — ancient civilizations, modern history, and everything in between.',
     'history', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000010', host, 'Philosophy Corner',
     'Ideas, ethics, existentialism, and intellectual discourse. Think deeply, discuss freely.',
     'history', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000011', host, 'The Sports Bar',
     'All sports, all day. Football, basketball, soccer, and beyond. Scores, highlights, and hot takes.',
     'sports', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed00000012', host, 'Science & Space',
     'Science news, space exploration, physics, astronomy, and the wonders of the natural world.',
     'science', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000013', host, 'Politics & World Affairs',
     'Political discussion, geopolitics, and current affairs. Respectful debate encouraged.',
     'politics', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000014', host, 'Memes & Random',
     'The best (and worst) memes, random thoughts, and general chaos.',
     'random', 'read-write', 1, true, true, NOW(), 80, admin_pk, ts),

    ('seed00000015', host, 'Self Improvement',
     'Fitness, productivity, books, habits, and becoming a better version of yourself.',
     'lifestyle', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000016', host, 'Food & Cooking',
     'Recipes, restaurant discoveries, cooking tips, and food photography.',
     'lifestyle', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000017', host, 'Fashion & Style',
     'Streetwear, high fashion, fits of the day, and style inspiration.',
     'lifestyle', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000018', host, 'Books & Literature',
     'Book recommendations, reading discussions, and literary analysis.',
     'education', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts),

    ('seed00000019', host, 'The Cypherpunk Lounge',
     'Encryption, privacy tech, cypherpunk philosophy, and digital sovereignty.',
     'crypto', 'read-write', 1, false, true, NOW(), 40, admin_pk, ts)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. Channels ────────────────────────────────────────────────────────────
  -- Read-only: notes + media/articles (no chat)
  -- Read-write: chat (default) + notes + media/articles/music

  INSERT INTO app.space_channels
    (id, space_id, type, label, position, is_default, admin_only, slow_mode_seconds, temporary)
  VALUES
    -- 01: Nostr Highlights (read-only)
    ('sc01note0001', 'seed00000001', 'notes',    '#notes',    0, true,  false, 0, false),
    ('sc01mdia0001', 'seed00000001', 'media',    '#media',    1, false, false, 0, false),
    -- 02: Privacy & Freedom (read-only)
    ('sc02note0001', 'seed00000002', 'notes',    '#notes',    0, true,  false, 0, false),
    ('sc02artc0001', 'seed00000002', 'articles', '#articles', 1, false, false, 0, false),
    -- 03: Bitcoin Signal (read-only)
    ('sc03note0001', 'seed00000003', 'notes',    '#notes',    0, true,  false, 0, false),
    ('sc03artc0001', 'seed00000003', 'articles', '#articles', 1, false, false, 0, false),
    -- 04: Tech Voices (read-only)
    ('sc04note0001', 'seed00000004', 'notes',    '#notes',    0, true,  false, 0, false),
    ('sc04artc0001', 'seed00000004', 'articles', '#articles', 1, false, false, 0, false),
    -- 05: Nostr Dev Feed (read-only)
    ('sc05note0001', 'seed00000005', 'notes',    '#notes',    0, true,  false, 0, false),
    ('sc05mdia0001', 'seed00000005', 'media',    '#media',    1, false, false, 0, false),
    -- 06: Music Discovery
    ('sc06chat0001', 'seed00000006', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc06note0001', 'seed00000006', 'notes', '#notes', 1, false, false, 0, false),
    ('sc06mdia0001', 'seed00000006', 'media', '#media', 2, false, false, 0, false),
    ('sc06musc0001', 'seed00000006', 'music', '#music', 3, false, false, 0, false),
    -- 07: Album Club
    ('sc07chat0001', 'seed00000007', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc07note0001', 'seed00000007', 'notes', '#notes', 1, false, false, 0, false),
    ('sc07musc0001', 'seed00000007', 'music', '#music', 2, false, false, 0, false),
    -- 08: Hip Hop & R&B
    ('sc08chat0001', 'seed00000008', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc08note0001', 'seed00000008', 'notes', '#notes', 1, false, false, 0, false),
    ('sc08mdia0001', 'seed00000008', 'media', '#media', 2, false, false, 0, false),
    ('sc08musc0001', 'seed00000008', 'music', '#music', 3, false, false, 0, false),
    -- 09: Art & Aesthetics
    ('sc09chat0001', 'seed00000009', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc09note0001', 'seed00000009', 'notes', '#notes', 1, false, false, 0, false),
    ('sc09mdia0001', 'seed00000009', 'media', '#media', 2, false, false, 0, false),
    -- 0a: Photography
    ('sc0achat0001', 'seed0000000a', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc0anote0001', 'seed0000000a', 'notes', '#notes', 1, false, false, 0, false),
    ('sc0amdia0001', 'seed0000000a', 'media', '#media', 2, false, false, 0, false),
    -- 0b: Creative Corner
    ('sc0bchat0001', 'seed0000000b', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc0bnote0001', 'seed0000000b', 'notes', '#notes', 1, false, false, 0, false),
    ('sc0bmdia0001', 'seed0000000b', 'media', '#media', 2, false, false, 0, false),
    -- 0c: Gaming Lounge
    ('sc0cchat0001', 'seed0000000c', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc0cnote0001', 'seed0000000c', 'notes', '#notes', 1, false, false, 0, false),
    ('sc0cmdia0001', 'seed0000000c', 'media', '#media', 2, false, false, 0, false),
    -- 0d: Anime & Manga
    ('sc0dchat0001', 'seed0000000d', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc0dnote0001', 'seed0000000d', 'notes', '#notes', 1, false, false, 0, false),
    ('sc0dmdia0001', 'seed0000000d', 'media', '#media', 2, false, false, 0, false),
    -- 0e: Film & Television
    ('sc0echat0001', 'seed0000000e', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc0enote0001', 'seed0000000e', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc0emdia0001', 'seed0000000e', 'media',    '#media',    2, false, false, 0, false),
    ('sc0eartc0001', 'seed0000000e', 'articles', '#articles', 3, false, false, 0, false),
    -- 0f: World History
    ('sc0fchat0001', 'seed0000000f', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc0fnote0001', 'seed0000000f', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc0fartc0001', 'seed0000000f', 'articles', '#articles', 2, false, false, 0, false),
    -- 10: Philosophy Corner
    ('sc10chat0001', 'seed00000010', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc10note0001', 'seed00000010', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc10artc0001', 'seed00000010', 'articles', '#articles', 2, false, false, 0, false),
    -- 11: The Sports Bar
    ('sc11chat0001', 'seed00000011', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc11note0001', 'seed00000011', 'notes', '#notes', 1, false, false, 0, false),
    ('sc11mdia0001', 'seed00000011', 'media', '#media', 2, false, false, 0, false),
    -- 12: Science & Space
    ('sc12chat0001', 'seed00000012', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc12note0001', 'seed00000012', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc12mdia0001', 'seed00000012', 'media',    '#media',    2, false, false, 0, false),
    ('sc12artc0001', 'seed00000012', 'articles', '#articles', 3, false, false, 0, false),
    -- 13: Politics & World Affairs
    ('sc13chat0001', 'seed00000013', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc13note0001', 'seed00000013', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc13artc0001', 'seed00000013', 'articles', '#articles', 2, false, false, 0, false),
    -- 14: Memes & Random
    ('sc14chat0001', 'seed00000014', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc14note0001', 'seed00000014', 'notes', '#notes', 1, false, false, 0, false),
    ('sc14mdia0001', 'seed00000014', 'media', '#media', 2, false, false, 0, false),
    -- 15: Self Improvement
    ('sc15chat0001', 'seed00000015', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc15note0001', 'seed00000015', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc15artc0001', 'seed00000015', 'articles', '#articles', 2, false, false, 0, false),
    -- 16: Food & Cooking
    ('sc16chat0001', 'seed00000016', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc16note0001', 'seed00000016', 'notes', '#notes', 1, false, false, 0, false),
    ('sc16mdia0001', 'seed00000016', 'media', '#media', 2, false, false, 0, false),
    -- 17: Fashion & Style
    ('sc17chat0001', 'seed00000017', 'chat',  '#chat',  0, true,  false, 0, false),
    ('sc17note0001', 'seed00000017', 'notes', '#notes', 1, false, false, 0, false),
    ('sc17mdia0001', 'seed00000017', 'media', '#media', 2, false, false, 0, false),
    -- 18: Books & Literature
    ('sc18chat0001', 'seed00000018', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc18note0001', 'seed00000018', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc18artc0001', 'seed00000018', 'articles', '#articles', 2, false, false, 0, false),
    -- 19: The Cypherpunk Lounge
    ('sc19chat0001', 'seed00000019', 'chat',     '#chat',     0, true,  false, 0, false),
    ('sc19note0001', 'seed00000019', 'notes',    '#notes',    1, false, false, 0, false),
    ('sc19artc0001', 'seed00000019', 'articles', '#articles', 2, false, false, 0, false)
  ON CONFLICT (id) DO NOTHING;

  -- ── 3. Roles (Admin + Member per space) ────────────────────────────────────

  INSERT INTO app.space_roles (id, space_id, name, position, is_default, is_admin) VALUES
    ('sr01admin001', 'seed00000001', 'Admin', 0, false, true),  ('sr01membr001', 'seed00000001', 'Member', 1, true, false),
    ('sr02admin001', 'seed00000002', 'Admin', 0, false, true),  ('sr02membr001', 'seed00000002', 'Member', 1, true, false),
    ('sr03admin001', 'seed00000003', 'Admin', 0, false, true),  ('sr03membr001', 'seed00000003', 'Member', 1, true, false),
    ('sr04admin001', 'seed00000004', 'Admin', 0, false, true),  ('sr04membr001', 'seed00000004', 'Member', 1, true, false),
    ('sr05admin001', 'seed00000005', 'Admin', 0, false, true),  ('sr05membr001', 'seed00000005', 'Member', 1, true, false),
    ('sr06admin001', 'seed00000006', 'Admin', 0, false, true),  ('sr06membr001', 'seed00000006', 'Member', 1, true, false),
    ('sr07admin001', 'seed00000007', 'Admin', 0, false, true),  ('sr07membr001', 'seed00000007', 'Member', 1, true, false),
    ('sr08admin001', 'seed00000008', 'Admin', 0, false, true),  ('sr08membr001', 'seed00000008', 'Member', 1, true, false),
    ('sr09admin001', 'seed00000009', 'Admin', 0, false, true),  ('sr09membr001', 'seed00000009', 'Member', 1, true, false),
    ('sr0aadmin001', 'seed0000000a', 'Admin', 0, false, true),  ('sr0amembr001', 'seed0000000a', 'Member', 1, true, false),
    ('sr0badmin001', 'seed0000000b', 'Admin', 0, false, true),  ('sr0bmembr001', 'seed0000000b', 'Member', 1, true, false),
    ('sr0cadmin001', 'seed0000000c', 'Admin', 0, false, true),  ('sr0cmembr001', 'seed0000000c', 'Member', 1, true, false),
    ('sr0dadmin001', 'seed0000000d', 'Admin', 0, false, true),  ('sr0dmembr001', 'seed0000000d', 'Member', 1, true, false),
    ('sr0eadmin001', 'seed0000000e', 'Admin', 0, false, true),  ('sr0emembr001', 'seed0000000e', 'Member', 1, true, false),
    ('sr0fadmin001', 'seed0000000f', 'Admin', 0, false, true),  ('sr0fmembr001', 'seed0000000f', 'Member', 1, true, false),
    ('sr10admin001', 'seed00000010', 'Admin', 0, false, true),  ('sr10membr001', 'seed00000010', 'Member', 1, true, false),
    ('sr11admin001', 'seed00000011', 'Admin', 0, false, true),  ('sr11membr001', 'seed00000011', 'Member', 1, true, false),
    ('sr12admin001', 'seed00000012', 'Admin', 0, false, true),  ('sr12membr001', 'seed00000012', 'Member', 1, true, false),
    ('sr13admin001', 'seed00000013', 'Admin', 0, false, true),  ('sr13membr001', 'seed00000013', 'Member', 1, true, false),
    ('sr14admin001', 'seed00000014', 'Admin', 0, false, true),  ('sr14membr001', 'seed00000014', 'Member', 1, true, false),
    ('sr15admin001', 'seed00000015', 'Admin', 0, false, true),  ('sr15membr001', 'seed00000015', 'Member', 1, true, false),
    ('sr16admin001', 'seed00000016', 'Admin', 0, false, true),  ('sr16membr001', 'seed00000016', 'Member', 1, true, false),
    ('sr17admin001', 'seed00000017', 'Admin', 0, false, true),  ('sr17membr001', 'seed00000017', 'Member', 1, true, false),
    ('sr18admin001', 'seed00000018', 'Admin', 0, false, true),  ('sr18membr001', 'seed00000018', 'Member', 1, true, false),
    ('sr19admin001', 'seed00000019', 'Admin', 0, false, true),  ('sr19membr001', 'seed00000019', 'Member', 1, true, false)
  ON CONFLICT (id) DO NOTHING;

  -- ── 4. Role Permissions (11 default permissions for each Member role) ──────

  INSERT INTO app.role_permissions (role_id, permission)
  SELECT r.id, p.perm
  FROM (VALUES
    ('sr01membr001'), ('sr02membr001'), ('sr03membr001'), ('sr04membr001'), ('sr05membr001'),
    ('sr06membr001'), ('sr07membr001'), ('sr08membr001'), ('sr09membr001'), ('sr0amembr001'),
    ('sr0bmembr001'), ('sr0cmembr001'), ('sr0dmembr001'), ('sr0emembr001'), ('sr0fmembr001'),
    ('sr10membr001'), ('sr11membr001'), ('sr12membr001'), ('sr13membr001'), ('sr14membr001'),
    ('sr15membr001'), ('sr16membr001'), ('sr17membr001'), ('sr18membr001'), ('sr19membr001')
  ) AS r(id)
  CROSS JOIN (VALUES
    ('SEND_MESSAGES'), ('CREATE_INVITES'), ('EMBED_LINKS'), ('ATTACH_FILES'),
    ('ADD_REACTIONS'), ('CONNECT'), ('SPEAK'), ('VIDEO'), ('SCREEN_SHARE'),
    ('VIEW_CHANNEL'), ('READ_MESSAGE_HISTORY')
  ) AS p(perm)
  ON CONFLICT DO NOTHING;

  -- ── 5. Space Members (admin joins all seed spaces) ─────────────────────────

  INSERT INTO app.space_members (space_id, pubkey) VALUES
    ('seed00000001', admin_pk), ('seed00000002', admin_pk), ('seed00000003', admin_pk),
    ('seed00000004', admin_pk), ('seed00000005', admin_pk), ('seed00000006', admin_pk),
    ('seed00000007', admin_pk), ('seed00000008', admin_pk), ('seed00000009', admin_pk),
    ('seed0000000a', admin_pk), ('seed0000000b', admin_pk), ('seed0000000c', admin_pk),
    ('seed0000000d', admin_pk), ('seed0000000e', admin_pk), ('seed0000000f', admin_pk),
    ('seed00000010', admin_pk), ('seed00000011', admin_pk), ('seed00000012', admin_pk),
    ('seed00000013', admin_pk), ('seed00000014', admin_pk), ('seed00000015', admin_pk),
    ('seed00000016', admin_pk), ('seed00000017', admin_pk), ('seed00000018', admin_pk),
    ('seed00000019', admin_pk)
  ON CONFLICT DO NOTHING;

  -- ── 6. Member Roles (admin gets Admin + Member roles) ───────────��──────────

  INSERT INTO app.member_roles (space_id, pubkey, role_id) VALUES
    ('seed00000001', admin_pk, 'sr01admin001'), ('seed00000001', admin_pk, 'sr01membr001'),
    ('seed00000002', admin_pk, 'sr02admin001'), ('seed00000002', admin_pk, 'sr02membr001'),
    ('seed00000003', admin_pk, 'sr03admin001'), ('seed00000003', admin_pk, 'sr03membr001'),
    ('seed00000004', admin_pk, 'sr04admin001'), ('seed00000004', admin_pk, 'sr04membr001'),
    ('seed00000005', admin_pk, 'sr05admin001'), ('seed00000005', admin_pk, 'sr05membr001'),
    ('seed00000006', admin_pk, 'sr06admin001'), ('seed00000006', admin_pk, 'sr06membr001'),
    ('seed00000007', admin_pk, 'sr07admin001'), ('seed00000007', admin_pk, 'sr07membr001'),
    ('seed00000008', admin_pk, 'sr08admin001'), ('seed00000008', admin_pk, 'sr08membr001'),
    ('seed00000009', admin_pk, 'sr09admin001'), ('seed00000009', admin_pk, 'sr09membr001'),
    ('seed0000000a', admin_pk, 'sr0aadmin001'), ('seed0000000a', admin_pk, 'sr0amembr001'),
    ('seed0000000b', admin_pk, 'sr0badmin001'), ('seed0000000b', admin_pk, 'sr0bmembr001'),
    ('seed0000000c', admin_pk, 'sr0cadmin001'), ('seed0000000c', admin_pk, 'sr0cmembr001'),
    ('seed0000000d', admin_pk, 'sr0dadmin001'), ('seed0000000d', admin_pk, 'sr0dmembr001'),
    ('seed0000000e', admin_pk, 'sr0eadmin001'), ('seed0000000e', admin_pk, 'sr0emembr001'),
    ('seed0000000f', admin_pk, 'sr0fadmin001'), ('seed0000000f', admin_pk, 'sr0fmembr001'),
    ('seed00000010', admin_pk, 'sr10admin001'), ('seed00000010', admin_pk, 'sr10membr001'),
    ('seed00000011', admin_pk, 'sr11admin001'), ('seed00000011', admin_pk, 'sr11membr001'),
    ('seed00000012', admin_pk, 'sr12admin001'), ('seed00000012', admin_pk, 'sr12membr001'),
    ('seed00000013', admin_pk, 'sr13admin001'), ('seed00000013', admin_pk, 'sr13membr001'),
    ('seed00000014', admin_pk, 'sr14admin001'), ('seed00000014', admin_pk, 'sr14membr001'),
    ('seed00000015', admin_pk, 'sr15admin001'), ('seed00000015', admin_pk, 'sr15membr001'),
    ('seed00000016', admin_pk, 'sr16admin001'), ('seed00000016', admin_pk, 'sr16membr001'),
    ('seed00000017', admin_pk, 'sr17admin001'), ('seed00000017', admin_pk, 'sr17membr001'),
    ('seed00000018', admin_pk, 'sr18admin001'), ('seed00000018', admin_pk, 'sr18membr001'),
    ('seed00000019', admin_pk, 'sr19admin001'), ('seed00000019', admin_pk, 'sr19membr001')
  ON CONFLICT DO NOTHING;

  -- ── 7. Feed Sources (read-only spaces only) ───────────────────────────────

  INSERT INTO app.space_feed_sources (space_id, pubkey) VALUES
    -- Nostr Highlights: fiatjaf, hodlbod, nostr.band
    ('seed00000001', fiatjaf_pk),
    ('seed00000001', hodlbod_pk),
    ('seed00000001', nostrband_pk),
    -- Privacy & Freedom: snowden, jack
    ('seed00000002', snowden_pk),
    ('seed00000002', jack_pk),
    -- Bitcoin Signal: jack, bitcoin magazine
    ('seed00000003', jack_pk),
    ('seed00000003', btcmag_pk),
    -- Tech Voices: jack, fiatjaf
    ('seed00000004', jack_pk),
    ('seed00000004', fiatjaf_pk),
    -- Nostr Dev Feed: fiatjaf, hodlbod
    ('seed00000005', fiatjaf_pk),
    ('seed00000005', hodlbod_pk)
  ON CONFLICT DO NOTHING;

  -- ── 8. Tags ────────────────────────────────────────────────────────────────

  INSERT INTO app.space_tags (id, space_id, tag) VALUES
    -- 01: Nostr Highlights
    ('st0000000001', 'seed00000001', 'nostr'),
    ('st0000000002', 'seed00000001', 'protocol'),
    ('st0000000003', 'seed00000001', 'open-source'),
    -- 02: Privacy & Freedom
    ('st0000000004', 'seed00000002', 'privacy'),
    ('st0000000005', 'seed00000002', 'freedom'),
    ('st0000000006', 'seed00000002', 'surveillance'),
    -- 03: Bitcoin Signal
    ('st0000000007', 'seed00000003', 'bitcoin'),
    ('st0000000008', 'seed00000003', 'finance'),
    ('st0000000009', 'seed00000003', 'economics'),
    -- 04: Tech Voices
    ('st0000000010', 'seed00000004', 'tech'),
    ('st0000000011', 'seed00000004', 'startups'),
    ('st0000000012', 'seed00000004', 'programming'),
    -- 05: Nostr Dev Feed
    ('st0000000013', 'seed00000005', 'dev'),
    ('st0000000014', 'seed00000005', 'building'),
    ('st0000000015', 'seed00000005', 'open-source'),
    -- 06: Music Discovery
    ('st0000000016', 'seed00000006', 'music'),
    ('st0000000017', 'seed00000006', 'new-releases'),
    ('st0000000018', 'seed00000006', 'playlists'),
    -- 07: Album Club
    ('st0000000019', 'seed00000007', 'albums'),
    ('st0000000020', 'seed00000007', 'reviews'),
    ('st0000000021', 'seed00000007', 'listening'),
    -- 08: Hip Hop & R&B
    ('st0000000022', 'seed00000008', 'hiphop'),
    ('st0000000023', 'seed00000008', 'rap'),
    ('st0000000024', 'seed00000008', 'rnb'),
    -- 09: Art & Aesthetics
    ('st0000000025', 'seed00000009', 'art'),
    ('st0000000026', 'seed00000009', 'aesthetics'),
    ('st0000000027', 'seed00000009', 'visual'),
    -- 0a: Photography
    ('st0000000028', 'seed0000000a', 'photography'),
    ('st0000000029', 'seed0000000a', 'cameras'),
    ('st0000000030', 'seed0000000a', 'editing'),
    -- 0b: Creative Corner
    ('st0000000031', 'seed0000000b', 'drawing'),
    ('st0000000032', 'seed0000000b', 'design'),
    ('st0000000033', 'seed0000000b', 'illustration'),
    -- 0c: Gaming Lounge
    ('st0000000034', 'seed0000000c', 'gaming'),
    ('st0000000035', 'seed0000000c', 'pc'),
    ('st0000000036', 'seed0000000c', 'console'),
    -- 0d: Anime & Manga
    ('st0000000037', 'seed0000000d', 'anime'),
    ('st0000000038', 'seed0000000d', 'manga'),
    ('st0000000039', 'seed0000000d', 'otaku'),
    -- 0e: Film & Television
    ('st0000000040', 'seed0000000e', 'movies'),
    ('st0000000041', 'seed0000000e', 'tv'),
    ('st0000000042', 'seed0000000e', 'cinema'),
    -- 0f: World History
    ('st0000000043', 'seed0000000f', 'history'),
    ('st0000000044', 'seed0000000f', 'civilization'),
    ('st0000000045', 'seed0000000f', 'ancient'),
    -- 10: Philosophy Corner
    ('st0000000046', 'seed00000010', 'philosophy'),
    ('st0000000047', 'seed00000010', 'ethics'),
    ('st0000000048', 'seed00000010', 'ideas'),
    -- 11: The Sports Bar
    ('st0000000049', 'seed00000011', 'sports'),
    ('st0000000050', 'seed00000011', 'football'),
    ('st0000000051', 'seed00000011', 'basketball'),
    -- 12: Science & Space
    ('st0000000052', 'seed00000012', 'science'),
    ('st0000000053', 'seed00000012', 'space'),
    ('st0000000054', 'seed00000012', 'astronomy'),
    -- 13: Politics & World Affairs
    ('st0000000055', 'seed00000013', 'politics'),
    ('st0000000056', 'seed00000013', 'geopolitics'),
    ('st0000000057', 'seed00000013', 'debate'),
    -- 14: Memes & Random
    ('st0000000058', 'seed00000014', 'memes'),
    ('st0000000059', 'seed00000014', 'shitposting'),
    ('st0000000060', 'seed00000014', 'funny'),
    -- 15: Self Improvement
    ('st0000000061', 'seed00000015', 'fitness'),
    ('st0000000062', 'seed00000015', 'productivity'),
    ('st0000000063', 'seed00000015', 'self-improvement'),
    -- 16: Food & Cooking
    ('st0000000064', 'seed00000016', 'food'),
    ('st0000000065', 'seed00000016', 'recipes'),
    ('st0000000066', 'seed00000016', 'cooking'),
    -- 17: Fashion & Style
    ('st0000000067', 'seed00000017', 'fashion'),
    ('st0000000068', 'seed00000017', 'streetwear'),
    ('st0000000069', 'seed00000017', 'fits'),
    -- 18: Books & Literature
    ('st0000000070', 'seed00000018', 'books'),
    ('st0000000071', 'seed00000018', 'reading'),
    ('st0000000072', 'seed00000018', 'literature'),
    -- 19: The Cypherpunk Lounge
    ('st0000000073', 'seed00000019', 'cypherpunk'),
    ('st0000000074', 'seed00000019', 'privacy'),
    ('st0000000075', 'seed00000019', 'encryption')
  ON CONFLICT (id) DO NOTHING;

END $$;
