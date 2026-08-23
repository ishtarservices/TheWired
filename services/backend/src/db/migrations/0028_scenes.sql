-- Scenes: a music-first browse vocabulary, distinct from app.space_categories.
--
-- Categories are 17 generic directory slugs (gaming, technology, music, …) where
-- "music" is one bucket holding every music space. That says nothing about an
-- underground scene, so clients were shipping their own curated taxonomy —
-- unshippable without an app release and unshared between desktop and mobile.
--
-- A scene spans BOTH space tags and music genres: `GET /discovery/scenes` hands
-- clients the mapping, and `GET /discovery/spaces?tag=a,b,c` ORs the tag list so
-- one scene resolves in a single request.

CREATE TABLE IF NOT EXISTS app.scenes (
    slug        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT,
    -- Music genre values (kind 31683/33123 `genre` tag), lowercase.
    genres      TEXT[] NOT NULL DEFAULT '{}',
    -- Space tag values (app.space_tags.tag), lowercase.
    tags        TEXT[] NOT NULL DEFAULT '{}',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenes_position ON app.scenes (position);

-- Seed vocabulary, lifted from the client-side curated list it replaces.
-- ON CONFLICT DO NOTHING so an operator's later edits survive re-runs.
INSERT INTO app.scenes (slug, label, description, genres, tags, position) VALUES
    ('alt-rap',     'Alt Rap',      'Left-of-centre rap, cloud, plugg, drain',
     ARRAY['hip hop','hip-hop','rap','trap','plugg','cloud rap','drain'],
     ARRAY['rap','hiphop','hip-hop','altrap','plugg','drain'], 10),
    ('experimental','Experimental', 'Noise, drone, musique concrète, deconstructed club',
     ARRAY['experimental','noise','drone','ambient','avant-garde','musique concrete'],
     ARRAY['experimental','noise','drone','ambient','avantgarde'], 20),
    ('garage-diy',  'Garage / DIY', 'Basement rock, lo-fi, shoegaze, self-released everything',
     ARRAY['garage','lo-fi','lofi','punk','shoegaze','indie rock','post-punk'],
     ARRAY['diy','garage','punk','lofi','shoegaze','indie'], 30),
    ('club',        'Club',         'Dance floors — techno, jungle, footwork, hard drum',
     ARRAY['techno','house','jungle','dnb','drum and bass','footwork','breakcore','hardcore'],
     ARRAY['club','techno','house','rave','dnb','jungle'], 40),
    ('vapor',       'Vapor',        'Vaporwave, plunderphonics, mallsoft, slowed',
     ARRAY['vaporwave','plunderphonics','mallsoft','chillwave','synthwave'],
     ARRAY['vapor','vaporwave','synthwave','aesthetic'], 50),
    ('soul',        'Soul',         'Soul, neo-soul, funk, jazz-adjacent',
     ARRAY['soul','neo-soul','neosoul','funk','r&b','rnb','jazz'],
     ARRAY['soul','funk','rnb','jazz'], 60)
ON CONFLICT (slug) DO NOTHING;
