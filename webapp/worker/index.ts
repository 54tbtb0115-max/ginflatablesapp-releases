import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Conversation, GalleryPage, GenerateRequest, Message } from '../shared/types';
import { type Env, type HistoryEntry, generateImage, refinePrompt, summarizeKeywords } from './ai';

type Vars = { userId: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const now = () => Date.now();
const uuid = () => crypto.randomUUID();

// ---------- 用户识别：首次访问发一个长期 cookie，自动建用户 ----------
app.use('/api/*', async (c, next) => {
    let uid = getCookie(c, 'uid');
    if (!uid) {
        uid = uuid();
        setCookie(c, 'uid', uid, {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 60 * 60 * 24 * 365,
        });
    }
    await c.env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)').bind(uid, now()).run();
    c.set('userId', uid);
    await next();
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : '服务出错了' }, 500);
});

// ---------- 会话 ----------
app.get('/api/conversations', async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT id, title, created_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC'
    )
        .bind(c.get('userId'))
        .all<{ id: string; title: string; created_at: number }>();
    const conversations: Conversation[] = results.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }));
    return c.json({ conversations });
});

app.post('/api/conversations', async (c) => {
    const id = uuid();
    await c.env.DB.prepare('INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, c.get('userId'), '新会话', now())
        .run();
    return c.json({ conversation: { id, title: '新会话', createdAt: now() } satisfies Conversation });
});

async function ownedConversation(c: { env: Env }, userId: string, conversationId: string) {
    const row = await c.env.DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .bind(conversationId, userId)
        .first();
    if (!row) throw new Error('会话不存在');
}

type MessageRow = { id: string; conversation_id: string; role: string; type: string; content: string; created_at: number };

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

app.get('/api/conversations/:id/messages', async (c) => {
    const conversationId = c.req.param('id');
    await ownedConversation(c, c.get('userId'), conversationId);
    const { results } = await c.env.DB.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
        .bind(conversationId)
        .all<MessageRow>();
    return c.json({ messages: results.map(rowToMessage) });
});

async function insertMessage(
    env: Env,
    conversationId: string,
    role: Message['role'],
    type: Message['type'],
    content: unknown
): Promise<Message> {
    const id = uuid();
    const createdAt = now();
    await env.DB.prepare(
        'INSERT INTO messages (id, conversation_id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
        .bind(id, conversationId, role, type, JSON.stringify(content), createdAt)
        .run();
    return { id, conversationId, role, type, content, createdAt } as Message;
}

// 取最近的消息拼成 LLM 上下文，保证同一会话内的对话是连续的
async function buildHistory(env: Env, conversationId: string): Promise<HistoryEntry[]> {
    const { results } = await env.DB.prepare(
        'SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20) ORDER BY created_at ASC'
    )
        .bind(conversationId)
        .all<MessageRow>();
    return results.map((r) => {
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

// ---------- 第一步：发文字，AI 总结关键词 ----------
app.post('/api/conversations/:id/chat', async (c) => {
    const conversationId = c.req.param('id');
    await ownedConversation(c, c.get('userId'), conversationId);
    const { text } = await c.req.json<{ text: string }>();
    if (!text?.trim()) return c.json({ error: '内容不能为空' }, 400);

    const history = await buildHistory(c.env, conversationId);
    const userMessage = await insertMessage(c.env, conversationId, 'user', 'text', { text: text.trim() });

    // 第一条消息顺便当会话标题
    if (history.length === 0) {
        await c.env.DB.prepare('UPDATE conversations SET title = ? WHERE id = ?')
            .bind(text.trim().slice(0, 20), conversationId)
            .run();
    }

    const keywords = await summarizeKeywords(c.env, history, text.trim());
    const assistantMessage = await insertMessage(c.env, conversationId, 'assistant', 'keywords', keywords);
    return c.json({ messages: [userMessage, assistantMessage] });
});

// ---------- 第二步：用户选好关键词，调生图模型 ----------
app.post('/api/conversations/:id/generate', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    await ownedConversation(c, userId, conversationId);
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
    const userMessage = await insertMessage(c.env, conversationId, 'user', 'text', { text: requestText });

    const promptEn = await refinePrompt(c.env, selectedSummary, body.note);

    // 图生图：把参考图从 R2 取出来一起传给图像模型
    let source: { bytes: Uint8Array; contentType: string } | undefined;
    if (body.sourceImageId) {
        const row = await c.env.DB.prepare('SELECT r2_key, content_type FROM images WHERE id = ?')
            .bind(body.sourceImageId)
            .first<{ r2_key: string; content_type: string }>();
        if (!row) return c.json({ error: '参考图不存在' }, 404);
        const object = await c.env.BUCKET.get(row.r2_key);
        if (!object) return c.json({ error: '参考图文件丢失' }, 404);
        source = { bytes: new Uint8Array(await object.arrayBuffer()), contentType: row.content_type };
    }

    const { bytes, contentType } = await generateImage(c.env, promptEn, source);
    const model = c.env.IMAGE_MODEL;

    // 图片实体写 R2，元数据写 D1
    const imageId = uuid();
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'png';
    const r2Key = `images/${userId}/${conversationId}/${imageId}.${ext}`;
    await c.env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } });

    const imageMessage = await insertMessage(c.env, conversationId, 'assistant', 'image', {
        imageId,
        prompt: selectedSummary,
        promptEn,
        sourceImageId: body.sourceImageId,
    });

    await c.env.DB.prepare(
        `INSERT INTO images (id, user_id, conversation_id, message_id, kind, r2_key, content_type, prompt, prompt_en, keywords, source_image_id, model, created_at)
         VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
        .bind(
            imageId,
            userId,
            conversationId,
            imageMessage.id,
            r2Key,
            contentType,
            selectedSummary,
            promptEn,
            JSON.stringify(body.selected),
            body.sourceImageId ?? null,
            model,
            now()
        )
        .run();

    return c.json({ messages: [userMessage, imageMessage] });
});

// ---------- 上传参考图（图生图入口之一） ----------
app.post('/api/conversations/:id/upload', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    await ownedConversation(c, userId, conversationId);

    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.startsWith('image/')) return c.json({ error: '请上传图片文件' }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: '文件为空' }, 400);
    if (bytes.length > 10 * 1024 * 1024) return c.json({ error: '图片不能超过 10MB' }, 400);

    const imageId = uuid();
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'png';
    const r2Key = `images/${userId}/${conversationId}/${imageId}.${ext}`;
    await c.env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } });

    const message = await insertMessage(c.env, conversationId, 'user', 'image', {
        imageId,
        prompt: '（上传的参考图）',
    });
    await c.env.DB.prepare(
        `INSERT INTO images (id, user_id, conversation_id, message_id, kind, r2_key, content_type, prompt, created_at)
         VALUES (?, ?, ?, ?, 'upload', ?, ?, '（上传的参考图）', ?)`
    )
        .bind(imageId, userId, conversationId, message.id, r2Key, contentType, now())
        .run();

    return c.json({ imageId, message });
});

// ---------- 图片文件（从 R2 读取，带缓存） ----------
app.get('/api/images/:id/file', async (c) => {
    const image = await c.env.DB.prepare('SELECT r2_key, content_type FROM images WHERE id = ?')
        .bind(c.req.param('id'))
        .first<{ r2_key: string; content_type: string }>();
    if (!image) return c.json({ error: '图片不存在' }, 404);
    const object = await c.env.BUCKET.get(image.r2_key);
    if (!object) return c.json({ error: '图片文件丢失' }, 404);
    return new Response(object.body as ReadableStream, {
        headers: {
            'Content-Type': image.content_type,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: object.httpEtag,
        },
    });
});

// ---------- 图库：所有用户生成的所有图片 ----------
app.get('/api/gallery', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 30), 60);
    const cursor = Number(c.req.query('cursor') ?? 0);
    const { results } = await c.env.DB.prepare(
        `SELECT id, prompt, prompt_en, keywords, source_image_id, model, created_at
         FROM images WHERE kind = 'generated' ${cursor > 0 ? 'AND created_at < ?' : ''}
         ORDER BY created_at DESC LIMIT ?`
    )
        .bind(...(cursor > 0 ? [cursor, limit] : [limit]))
        .all<{
            id: string;
            prompt: string | null;
            prompt_en: string | null;
            keywords: string | null;
            source_image_id: string | null;
            model: string | null;
            created_at: number;
        }>();

    const page: GalleryPage = {
        images: results.map((r) => ({
            id: r.id,
            prompt: r.prompt,
            promptEn: r.prompt_en,
            keywords: r.keywords,
            sourceImageId: r.source_image_id,
            model: r.model,
            createdAt: r.created_at,
        })),
        nextCursor: results.length === limit ? results[results.length - 1].created_at : null,
    };
    return c.json(page);
});

export default app;
