import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Conversation, GalleryPage, GenerateRequest, Message } from '../shared/types';
import { generateImage, planTurn, refinePrompt, type HistoryEntry } from './ai';
import { config } from './env';
import { db } from './db';
import { storage } from './storage';

type Vars = { userId: string };

export const app = new Hono<{ Variables: Vars }>();

const now = () => Date.now();

// ---------- 用户识别：首次访问发一个长期 cookie，自动建用户 ----------
app.use('/api/*', async (c, next) => {
    let uid = getCookie(c, 'uid');
    if (!uid) {
        uid = randomUUID();
        setCookie(c, 'uid', uid, {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 60 * 60 * 24 * 365,
        });
    }
    db.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)').run(uid, now());
    c.set('userId', uid);
    await next();
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : '服务出错了' }, 500);
});

// ---------- 会话 ----------
app.get('/api/conversations', (c) => {
    const rows = db
        .prepare('SELECT id, title, created_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC')
        .all(c.get('userId')) as { id: string; title: string; created_at: number }[];
    const conversations: Conversation[] = rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }));
    return c.json({ conversations });
});

app.post('/api/conversations', (c) => {
    const id = randomUUID();
    const createdAt = now();
    db.prepare('INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        c.get('userId'),
        '新会话',
        createdAt
    );
    return c.json({ conversation: { id, title: '新会话', createdAt } satisfies Conversation });
});

function ownedConversation(userId: string, conversationId: string): void {
    const row = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!row) throw new Error('会话不存在');
}

type MessageRow = {
    id: string;
    conversation_id: string;
    role: string;
    type: string;
    content: string;
    created_at: number;
};

function rowToMessage(r: MessageRow): Message {
    return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role as Message['role'],
        type: r.type,
        content: JSON.parse(r.content),
        createdAt: r.created_at,
    } as Message;
}

app.get('/api/conversations/:id/messages', (c) => {
    const conversationId = c.req.param('id');
    ownedConversation(c.get('userId'), conversationId);
    const rows = db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
        .all(conversationId) as MessageRow[];
    return c.json({ messages: rows.map(rowToMessage) });
});

function insertMessage(
    conversationId: string,
    role: Message['role'],
    type: Message['type'],
    content: unknown
): Message {
    const id = randomUUID();
    const createdAt = now();
    db.prepare(
        'INSERT INTO messages (id, conversation_id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, conversationId, role, type, JSON.stringify(content), createdAt);
    return { id, conversationId, role, type, content, createdAt } as Message;
}

// 取最近的消息拼成 LLM 上下文，保证同一会话内的对话是连续的
function buildHistory(conversationId: string): HistoryEntry[] {
    const rows = db
        .prepare(
            'SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20) ORDER BY created_at ASC'
        )
        .all(conversationId) as MessageRow[];
    return rows.map((r) => {
        const m = rowToMessage(r);
        let text: string;
        if (m.type === 'text') text = m.content.text;
        else if (m.type === 'keywords')
            text = `${m.content.reply}\n关键词：${m.content.groups
                .map((g) => `${g.name}=${g.options.join('/')}`)
                .join('；')}`;
        else text = `[已生成图片，提示词：${m.content.prompt}]`;
        return { role: m.role, content: text };
    });
}

// 取参考图字节（用于图生图）
async function loadSourceImage(imageId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const row = db.prepare('SELECT r2_key, content_type FROM images WHERE id = ?').get(imageId) as
        | { r2_key: string; content_type: string }
        | undefined;
    if (!row) return null;
    const bytes = await storage.get(row.r2_key);
    return bytes ? { bytes, contentType: row.content_type } : null;
}

// 调生图模型 → 图片写存储 → 元数据入库 → 生成一条图片消息
async function generateAndStore(opts: {
    userId: string;
    conversationId: string;
    promptCn: string;
    promptEn: string;
    keywordsJson?: string;
    sourceImageId?: string;
}): Promise<Message> {
    let source: { bytes: Uint8Array; contentType: string } | undefined;
    if (opts.sourceImageId) {
        source = (await loadSourceImage(opts.sourceImageId)) ?? undefined;
        if (!source) throw new Error('参考图不存在或文件丢失');
    }

    const { bytes, contentType } = await generateImage(opts.promptEn, source);

    const imageId = randomUUID();
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'png';
    const r2Key = `images/${opts.userId}/${opts.conversationId}/${imageId}.${ext}`;
    await storage.put(r2Key, bytes, contentType);

    const imageMessage = insertMessage(opts.conversationId, 'assistant', 'image', {
        imageId,
        prompt: opts.promptCn,
        promptEn: opts.promptEn,
        sourceImageId: opts.sourceImageId,
    });

    db.prepare(
        `INSERT INTO images (id, user_id, conversation_id, message_id, kind, r2_key, content_type, prompt, prompt_en, keywords, source_image_id, model, created_at)
         VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        imageId,
        opts.userId,
        opts.conversationId,
        imageMessage.id,
        r2Key,
        contentType,
        opts.promptCn,
        opts.promptEn,
        opts.keywordsJson ?? null,
        opts.sourceImageId ?? null,
        config.ai.imageModel,
        now()
    );

    return imageMessage;
}

// 本会话最近的一张图（生成的或上传的），用于"改上一张图"类指令
function lastImageId(conversationId: string): string | undefined {
    const row = db
        .prepare('SELECT id FROM images WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(conversationId) as { id: string } | undefined;
    return row?.id;
}

// ---------- 发消息：AI 判断是直接生成，还是先给关键词挑选 ----------
app.post('/api/conversations/:id/chat', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    ownedConversation(userId, conversationId);
    const { text, sourceImageId } = await c.req.json<{ text: string; sourceImageId?: string }>();
    if (!text?.trim()) return c.json({ error: '内容不能为空' }, 400);

    const history = buildHistory(conversationId);
    const userMessage = insertMessage(conversationId, 'user', 'text', { text: text.trim() });

    // 第一条消息顺便当会话标题
    if (history.length === 0) {
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(text.trim().slice(0, 20), conversationId);
    }

    const plan = await planTurn(history, text.trim());

    // 指令明确：跳过关键词挑选，直接生成
    if (plan.mode === 'direct') {
        const source = sourceImageId ?? (plan.useLastImage ? lastImageId(conversationId) : undefined);
        const replyMessage = insertMessage(conversationId, 'assistant', 'text', { text: plan.reply });
        const imageMessage = await generateAndStore({
            userId,
            conversationId,
            promptCn: text.trim(),
            promptEn: plan.promptEn,
            sourceImageId: source,
        });
        return c.json({ messages: [userMessage, replyMessage, imageMessage] });
    }

    const assistantMessage = insertMessage(conversationId, 'assistant', 'keywords', {
        reply: plan.reply,
        groups: plan.groups,
    });
    return c.json({ messages: [userMessage, assistantMessage] });
});

// ---------- 第二步：用户选好关键词，调生图模型 ----------
app.post('/api/conversations/:id/generate', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    ownedConversation(userId, conversationId);
    const body = await c.req.json<GenerateRequest>();

    const selectedSummary = Object.entries(body.selected ?? {})
        .filter(([, words]) => words.length > 0)
        .map(([group, words]) => `${group}=${words.join('、')}`)
        .join('；');
    if (!selectedSummary) return c.json({ error: '请至少选择一个关键词' }, 400);

    // 把用户的选择也记为一条消息，后续对话（例如"改成夜晚"）才有上下文
    const requestText = `请按这些关键词生成图片：${selectedSummary}${body.note ? `。补充：${body.note}` : ''}${
        body.sourceImageId ? '（基于参考图）' : ''
    }`;
    const userMessage = insertMessage(conversationId, 'user', 'text', { text: requestText });

    const promptEn = await refinePrompt(selectedSummary, body.note);
    const imageMessage = await generateAndStore({
        userId,
        conversationId,
        promptCn: selectedSummary,
        promptEn,
        keywordsJson: JSON.stringify(body.selected),
        sourceImageId: body.sourceImageId,
    });

    return c.json({ messages: [userMessage, imageMessage] });
});

// ---------- 上传参考图（图生图入口之一） ----------
app.post('/api/conversations/:id/upload', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    ownedConversation(userId, conversationId);

    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.startsWith('image/')) return c.json({ error: '请上传图片文件' }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: '文件为空' }, 400);
    if (bytes.length > 10 * 1024 * 1024) return c.json({ error: '图片不能超过 10MB' }, 400);

    const imageId = randomUUID();
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'png';
    const r2Key = `images/${userId}/${conversationId}/${imageId}.${ext}`;
    await storage.put(r2Key, bytes, contentType);

    const message = insertMessage(conversationId, 'user', 'image', {
        imageId,
        prompt: '（上传的参考图）',
    });
    db.prepare(
        `INSERT INTO images (id, user_id, conversation_id, message_id, kind, r2_key, content_type, prompt, created_at)
         VALUES (?, ?, ?, ?, 'upload', ?, ?, '（上传的参考图）', ?)`
    ).run(imageId, userId, conversationId, message.id, r2Key, contentType, now());

    return c.json({ imageId, message });
});

// ---------- 图片文件（从存储读取，带缓存） ----------
app.get('/api/images/:id/file', async (c) => {
    const image = db.prepare('SELECT r2_key, content_type FROM images WHERE id = ?').get(c.req.param('id')) as
        | { r2_key: string; content_type: string }
        | undefined;
    if (!image) return c.json({ error: '图片不存在' }, 404);
    const bytes = await storage.get(image.r2_key);
    if (!bytes) return c.json({ error: '图片文件丢失' }, 404);
    return c.body(bytes.buffer as ArrayBuffer, 200, {
        'Content-Type': image.content_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
    });
});

// ---------- 图库：所有用户生成的所有图片 ----------
app.get('/api/gallery', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 30), 60);
    const cursor = Number(c.req.query('cursor') ?? 0);
    const rows = db
        .prepare(
            `SELECT id, prompt, prompt_en, keywords, source_image_id, model, created_at
             FROM images WHERE kind = 'generated' ${cursor > 0 ? 'AND created_at < ?' : ''}
             ORDER BY created_at DESC LIMIT ?`
        )
        .all(...(cursor > 0 ? [cursor, limit] : [limit])) as {
        id: string;
        prompt: string | null;
        prompt_en: string | null;
        keywords: string | null;
        source_image_id: string | null;
        model: string | null;
        created_at: number;
    }[];

    const page: GalleryPage = {
        images: rows.map((r) => ({
            id: r.id,
            prompt: r.prompt,
            promptEn: r.prompt_en,
            keywords: r.keywords,
            sourceImageId: r.source_image_id,
            model: r.model,
            createdAt: r.created_at,
        })),
        nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
    return c.json(page);
});
