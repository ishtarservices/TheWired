-- Community onboarding system: questions, answers, role/channel mappings, welcome checklist

-- Per-space onboarding configuration (1:1 with spaces)
CREATE TABLE IF NOT EXISTS app.onboarding_config (
    space_id TEXT PRIMARY KEY REFERENCES app.spaces(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    welcome_message TEXT,
    welcome_image TEXT,
    require_completion BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Onboarding survey questions
CREATE TABLE IF NOT EXISTS app.onboarding_questions (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    multiple BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_questions_space ON app.onboarding_questions(space_id);

-- Selectable answers per question
CREATE TABLE IF NOT EXISTS app.onboarding_answers (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES app.onboarding_questions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    emoji TEXT,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_onboarding_answers_question ON app.onboarding_answers(question_id);

-- Maps answers to roles and/or channels
CREATE TABLE IF NOT EXISTS app.onboarding_answer_mappings (
    id TEXT PRIMARY KEY,
    answer_id TEXT NOT NULL REFERENCES app.onboarding_answers(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES app.space_roles(id) ON DELETE CASCADE,
    channel_id TEXT REFERENCES app.space_channels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_onboarding_mappings_answer ON app.onboarding_answer_mappings(answer_id);

-- Welcome checklist items
CREATE TABLE IF NOT EXISTS app.onboarding_todo_items (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    link_channel_id TEXT,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_onboarding_todos_space ON app.onboarding_todo_items(space_id);

-- Per-member onboarding completion state
CREATE TABLE IF NOT EXISTS app.member_onboarding_state (
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    answers TEXT,        -- JSON: [{questionId, answerIds}]
    todo_completed TEXT, -- JSON: ["todoId1", ...]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (space_id, pubkey)
);
CREATE INDEX IF NOT EXISTS idx_member_onboarding_space ON app.member_onboarding_state(space_id);
