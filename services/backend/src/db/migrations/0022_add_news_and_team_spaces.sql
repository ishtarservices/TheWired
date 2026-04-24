-- ============================================================================
-- 0022_add_news_and_team_spaces.sql
-- Add two additional featured seed spaces:
--   seed0000001a  "News Feed"     (read-only, category=news)
--   seed0000001b  "The Wired HQ"  (read-write, category=social)
--
-- Feed sources for News Feed are intentionally NOT seeded — wire them up via
-- the space settings UI after this migration runs.
--
-- Uses the same ID conventions as 0021 (ch_1a_*, role_1b_*, etc.). Pulls
-- admin pubkey dynamically from seed00000001 so it picks up the prod admin
-- after the swap. Safe to re-run (all ON CONFLICT DO NOTHING).
-- ============================================================================

DO $$
DECLARE
  admin_pk TEXT;
  host     TEXT;
  ts       BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
BEGIN
  SELECT creator_pubkey, host_relay INTO admin_pk, host
  FROM app.spaces WHERE id = 'seed00000001';

  IF admin_pk IS NULL THEN
    RAISE EXCEPTION '0022: seed00000001 not found — migrations 0015/0021 must run first';
  END IF;

  -- ── 1. Spaces ───────────────────────────────────────────────────────────
  INSERT INTO app.spaces
    (id, host_relay, name, about, category, language, mode, member_count,
     featured, listed, listed_at, discovery_score, creator_pubkey, created_at)
  VALUES
    ('seed0000001a', host, 'News Feed',
      'Hand-picked headlines from writers and newsrooms that earn your attention. World news, tech, culture, investigations — no rage bait, no algorithm games. Just signal.',
      'news', 'en', 'read', 1, TRUE, TRUE, NOW(), 85, admin_pk, ts),
    ('seed0000001b', host, 'The Wired HQ',
      'Where The Wired team meets the community in the open. Ask for help, file a bug, pitch a feature, or watch what''s shipping next. We read everything.',
      'social', 'en', 'read-write', 1, TRUE, TRUE, NOW(), 90, admin_pk, ts)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. Channels ─────────────────────────────────────────────────────────
  INSERT INTO app.space_channels
    (id, space_id, type, label, category_id, position, is_default, admin_only, slow_mode_seconds, temporary, feed_mode)
  VALUES
    -- News Feed
    ('ch_1a_headlines',  'seed0000001a', 'notes',    '#headlines',     'Feed',           0, TRUE,  FALSE, 0, FALSE, 'all'),
    ('ch_1a_deep_dives', 'seed0000001a', 'articles', '#deep-dives',    'Deep Dives',     1, FALSE, FALSE, 0, FALSE, 'all'),
    ('ch_1a_visuals',    'seed0000001a', 'media',    '#visuals',       'Feed',           2, FALSE, FALSE, 0, FALSE, 'all'),
    -- HQ
    ('ch_1b_help_desk',      'seed0000001b', 'chat',     '#help-desk',       'Support',        0, TRUE,  FALSE, 0, FALSE, 'all'),
    ('ch_1b_feedback',       'seed0000001b', 'chat',     '#feedback',        'Support',        1, FALSE, FALSE, 0, FALSE, 'all'),
    ('ch_1b_announcements',  'seed0000001b', 'chat',     '#announcements',   'From the Team',  2, FALSE, TRUE,  0, FALSE, 'all'),
    ('ch_1b_roadmap',        'seed0000001b', 'articles', '#roadmap',         'From the Team',  3, FALSE, TRUE,  0, FALSE, 'all'),
    ('ch_1b_introductions',  'seed0000001b', 'chat',     '#introductions',   'Community',      4, FALSE, FALSE, 0, FALSE, 'all')
  ON CONFLICT (id) DO NOTHING;

  -- ── 3. Tags ─────────────────────────────────────────────────────────────
  INSERT INTO app.space_tags (id, space_id, tag) VALUES
    ('tag_1a_0', 'seed0000001a', 'news'),
    ('tag_1a_1', 'seed0000001a', 'headlines'),
    ('tag_1a_2', 'seed0000001a', 'current-events'),
    ('tag_1a_3', 'seed0000001a', 'journalism'),
    ('tag_1a_4', 'seed0000001a', 'curated'),
    ('tag_1b_0', 'seed0000001b', 'wired'),
    ('tag_1b_1', 'seed0000001b', 'help'),
    ('tag_1b_2', 'seed0000001b', 'support'),
    ('tag_1b_3', 'seed0000001b', 'community'),
    ('tag_1b_4', 'seed0000001b', 'team')
  ON CONFLICT (id) DO NOTHING;

  -- ── 4. Admin + Member + themed roles ────────────────────────────────────
  INSERT INTO app.space_roles (id, space_id, name, position, color, is_default, is_admin) VALUES
    ('sr1aadmin001',       'seed0000001a', 'Admin',           0, NULL,      FALSE, TRUE),
    ('sr1amembr001',       'seed0000001a', 'Member',          1, NULL,      TRUE,  FALSE),
    ('role_1a_news_hound', 'seed0000001a', 'News Hound',      3, '#E74C3C', FALSE, FALSE),
    ('sr1badmin001',       'seed0000001b', 'Admin',           0, NULL,      FALSE, TRUE),
    ('sr1bmembr001',       'seed0000001b', 'Member',          2, NULL,      TRUE,  FALSE),
    ('role_1b_moderator',  'seed0000001b', 'Moderator',       1, '#FF6B6B', FALSE, FALSE),
    ('role_1b_insider',    'seed0000001b', 'Wired Insider',   3, '#00D4AA', FALSE, FALSE)
  ON CONFLICT (id) DO NOTHING;

  -- ── 5. Role permissions ─────────────────────────────────────────────────
  -- Standard 11-permission set for Members + themed non-mod roles
  INSERT INTO app.role_permissions (role_id, permission)
  SELECT r.id, p.perm
  FROM (VALUES
    ('sr1amembr001'),
    ('sr1bmembr001'),
    ('role_1a_news_hound'),
    ('role_1b_insider')
  ) AS r(id)
  CROSS JOIN (VALUES
    ('SEND_MESSAGES'), ('CREATE_INVITES'), ('EMBED_LINKS'), ('ATTACH_FILES'),
    ('ADD_REACTIONS'), ('CONNECT'), ('SPEAK'), ('VIDEO'), ('SCREEN_SHARE'),
    ('VIEW_CHANNEL'), ('READ_MESSAGE_HISTORY')
  ) AS p(perm)
  ON CONFLICT DO NOTHING;

  -- Moderator gets the 11 standard perms + MANAGE_CHANNELS
  INSERT INTO app.role_permissions (role_id, permission)
  SELECT 'role_1b_moderator', perm FROM (VALUES
    ('SEND_MESSAGES'), ('CREATE_INVITES'), ('EMBED_LINKS'), ('ATTACH_FILES'),
    ('ADD_REACTIONS'), ('CONNECT'), ('SPEAK'), ('VIDEO'), ('SCREEN_SHARE'),
    ('VIEW_CHANNEL'), ('READ_MESSAGE_HISTORY'), ('MANAGE_CHANNELS')
  ) AS p(perm)
  ON CONFLICT DO NOTHING;

  -- ── 6. Admin as member with Admin + Member roles ────────────────────────
  INSERT INTO app.space_members (space_id, pubkey) VALUES
    ('seed0000001a', admin_pk),
    ('seed0000001b', admin_pk)
  ON CONFLICT DO NOTHING;

  INSERT INTO app.member_roles (space_id, pubkey, role_id) VALUES
    ('seed0000001a', admin_pk, 'sr1aadmin001'),
    ('seed0000001a', admin_pk, 'sr1amembr001'),
    ('seed0000001b', admin_pk, 'sr1badmin001'),
    ('seed0000001b', admin_pk, 'sr1bmembr001')
  ON CONFLICT DO NOTHING;

  -- ── 7. Onboarding config ────────────────────────────────────────────────
  INSERT INTO app.onboarding_config (space_id, enabled, welcome_message, require_completion, updated_at) VALUES
    ('seed0000001a', TRUE,
      'Welcome to News Feed — curated headlines from reporters and writers who earn your attention. Pick your lens below and we''ll tune what surfaces first.',
      FALSE, NOW()),
    ('seed0000001b', TRUE,
      'You''re at The Wired HQ — the room where our team talks with you directly. Ask for help, file a bug, pitch a feature, or just see what''s shipping. We read everything.',
      FALSE, NOW())
  ON CONFLICT (space_id) DO NOTHING;

  -- ── 8. Onboarding questions / answers / mappings ────────────────────────
  INSERT INTO app.onboarding_questions (id, space_id, title, description, position, required, multiple) VALUES
    ('q_1a_0', 'seed0000001a', 'What do you read?', 'Pick what you want to see most.', 0, TRUE, TRUE),
    ('q_1b_0', 'seed0000001b', 'What brings you in?', NULL, 0, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO app.onboarding_answers (id, question_id, label, emoji, position) VALUES
    ('a_1a_0_0', 'q_1a_0', 'World & politics',              '🌍', 0),
    ('a_1a_0_1', 'q_1a_0', 'Tech & science',                '🔬', 1),
    ('a_1a_0_2', 'q_1a_0', 'Culture & the arts',            '🎭', 2),
    ('a_1a_0_3', 'q_1a_0', 'Investigations & long reads',   '📰', 3),
    ('a_1b_0_0', 'q_1b_0', 'I need help with the app',      '🛟', 0),
    ('a_1b_0_1', 'q_1b_0', 'I''m building on The Wired',    '🛠️', 1),
    ('a_1b_0_2', 'q_1b_0', 'Just curious what''s going on',  '👀', 2)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO app.onboarding_answer_mappings (id, answer_id, role_id, channel_id) VALUES
    ('m_1a_0_0', 'a_1a_0_0', 'role_1a_news_hound', 'ch_1a_headlines'),
    ('m_1a_0_1', 'a_1a_0_1', 'role_1a_news_hound', 'ch_1a_headlines'),
    ('m_1a_0_2', 'a_1a_0_2', 'role_1a_news_hound', 'ch_1a_visuals'),
    ('m_1a_0_3', 'a_1a_0_3', 'role_1a_news_hound', 'ch_1a_deep_dives'),
    ('m_1b_0_0', 'a_1b_0_0', NULL,                  'ch_1b_help_desk'),
    ('m_1b_0_1', 'a_1b_0_1', 'role_1b_insider',     'ch_1b_roadmap'),
    ('m_1b_0_2', 'a_1b_0_2', NULL,                  'ch_1b_announcements')
  ON CONFLICT (id) DO NOTHING;

  -- ── 9. Welcome checklists ───────────────────────────────────────────────
  INSERT INTO app.onboarding_todo_items (id, space_id, title, description, link_channel_id, position) VALUES
    ('todo_1a_0', 'seed0000001a', 'Scroll today''s #headlines',         NULL, 'ch_1a_headlines',     0),
    ('todo_1a_1', 'seed0000001a', 'Read a piece in #deep-dives',        NULL, 'ch_1a_deep_dives',    1),
    ('todo_1a_2', 'seed0000001a', 'Catch the day in #visuals',          NULL, 'ch_1a_visuals',       2),
    ('todo_1b_0', 'seed0000001b', 'Say hi in #introductions',           NULL, 'ch_1b_introductions', 0),
    ('todo_1b_1', 'seed0000001b', 'See what''s shipping in #roadmap',   NULL, 'ch_1b_roadmap',       1),
    ('todo_1b_2', 'seed0000001b', 'Ask anything in #help-desk',         NULL, 'ch_1b_help_desk',     2)
  ON CONFLICT (id) DO NOTHING;

  -- ── 10. Discovery listings (pre-approved) ───────────────────────────────
  INSERT INTO app.listing_requests
    (id, space_id, requester_pubkey, status, category, reviewer_pubkey, reviewed_at)
  VALUES
    ('lr_1a', 'seed0000001a', admin_pk, 'approved', 'news',   admin_pk, NOW()),
    ('lr_1b', 'seed0000001b', admin_pk, 'approved', 'social', admin_pk, NOW())
  ON CONFLICT (id) DO NOTHING;

END $$;

-- Verify (expected: 2 / 8 / 10 / 7 / 2 / 2 / 7 / 7 / 6 / 2)
SELECT 'spaces'               AS k, count(*) FROM app.spaces              WHERE id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'channels',         count(*) FROM app.space_channels         WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'tags',             count(*) FROM app.space_tags             WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'roles',            count(*) FROM app.space_roles            WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'onboarding',       count(*) FROM app.onboarding_config      WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'questions',        count(*) FROM app.onboarding_questions   WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'answers',          count(*) FROM app.onboarding_answers     WHERE question_id IN ('q_1a_0','q_1b_0')
UNION ALL SELECT 'mappings',         count(*) FROM app.onboarding_answer_mappings WHERE id LIKE 'm_1%'
UNION ALL SELECT 'todos',            count(*) FROM app.onboarding_todo_items  WHERE space_id IN ('seed0000001a','seed0000001b')
UNION ALL SELECT 'listings',         count(*) FROM app.listing_requests       WHERE id IN ('lr_1a','lr_1b') AND status='approved';
