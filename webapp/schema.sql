-- D1 数据库结构
-- 执行：npm run db:migrate:local（本地） / npm run db:migrate（线上）

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

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
