-- D1 数据库结构
-- 执行：npm run db:migrate:local（本地） / npm run db:migrate（线上）

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT,
    password_hash TEXT,
    created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- 登录会话
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 关键词使用记录：每生成一张图，勾选的每个关键词记一行，用于统计哪些词用得多
CREATE TABLE IF NOT EXISTS keyword_usages (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    conversation_id TEXT,
    image_id        TEXT,
    group_name      TEXT NOT NULL,
    word            TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyword_usages_word ON keyword_usages(group_name, word);

CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL DEFAULT '新会话',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, created_at DESC);

-- role: user | assistant
-- type: text | keywords | image
-- content: JSON，按 type 区分：
--   text     -> {"text": "..."}
--   keywords -> {"reply": "...", "groups": [{"name": "场景", "options": ["海边", ...]}, ...]}
--   image    -> {"imageId": "...", "prompt": "...", "sourceImageId": "..."}
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL,
    type            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- kind: generated（AI 生成） | upload（用户上传的参考图）
CREATE TABLE IF NOT EXISTS images (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    conversation_id TEXT REFERENCES conversations(id),
    message_id      TEXT REFERENCES messages(id),
    kind            TEXT NOT NULL DEFAULT 'generated',
    r2_key          TEXT NOT NULL,
    content_type    TEXT NOT NULL DEFAULT 'image/png',
    prompt          TEXT,
    prompt_en       TEXT,
    keywords        TEXT,
    source_image_id TEXT REFERENCES images(id),
    model           TEXT,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id, created_at DESC);
