import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AdminStats, Conversation, GalleryPage, GenerateRequest, KeywordStat, Message } from '../shared/types';
import { generateImage, planTurn, refinePrompt, summarizeKeywords, type HistoryEntry } from './ai';
import { SESSION_DAYS, changePassword, createSession, deleteSession, loginUser, sessionUser } from './auth';
import { config, resolveImageModel } from './env';
import { db } from './db';
import { storage } from './storage';

type Vars = { userId: string };

export const app = new Hono<{ Variables: Vars }>();

const now = () => Date.now();

// ---------- 鉴权：除注册/登录接口外，一律需要登录 ----------
app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    const token = getCookie(c, 'sid');
    const user = token ? sessionUser(token) : null;
    if (!user) return c.json({ error: '未登录' }, 401);
    c.set('userId', user.id);
    await next();
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : '服务出错了' }, 500);
});

// ---------- 账号 ----------
function issueSession(c: Context, userId: string) {
    const token = createSession(userId);
    setCookie(c, 'sid', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
}

// 不开放自助注册：账号由管理员在服务器上创建（npm run user add 用户名 密码）后分发
app.post('/api/auth/login', async (c) => {
    const { username, password } = await c.req.json<{ username: string; password: string }>();
    const user = loginUser(username ?? '', password ?? '');
    issueSession(c, user.id);
    return c.json({ user });
});

app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, 'sid');
    if (token) deleteSession(token);
    deleteCookie(c, 'sid', { path: '/' });
    return c.json({ ok: true });
});

// 修改密码（路径不在 /api/auth/ 下，走登录鉴权）
app.post('/api/account/password', async (c) => {
    const { oldPassword, newPassword } = await c.req.json<{ oldPassword: string; newPassword: string }>();
    changePassword(c.get('userId'), oldPassword ?? '', newPassword ?? '');
    return c.json({ ok: true });
});

const isAdminUser = (username: string) => config.adminUsers.includes(username);

app.get('/api/auth/me', (c) => {
    const token = getCookie(c, 'sid');
    const user = token ? sessionUser(token) : null;
    if (!user) return c.json({ error: '未登录' }, 401);
    return c.json({ user: { ...user, isAdmin: isAdminUser(user.username) } });
});

// ---------- 管理员统计（仅管理员账号可访问） ----------
app.get('/api/admin/stats', (c) => {
    const token = getCookie(c, 'sid');
    const user = token ? sessionUser(token) : null;
    if (!user || !isAdminUser(user.username)) return c.json({ error: '无权限' }, 403);

    // 日期范围（epoch 毫秒）；缺省时默认最近 30 天
    const toRaw = Number(c.req.query('to'));
    const fromRaw = Number(c.req.query('from'));
    const to = Number.isFinite(toRaw) && toRaw > 0 ? toRaw : Date.now();
    const from = Number.isFinite(fromRaw) && fromRaw >= 0 ? fromRaw : to - 30 * 24 * 60 * 60 * 1000;
    const where = "kind = 'generated' AND created_at >= ? AND created_at <= ?";
    const priceOf = (model: string) => config.imagePrices[model] ?? 0;

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM images WHERE ${where}`).get(from, to) as { n: number }).n;

    // 失败/停止数（来自消息，图片表只存成功的）
    const failed = (
        db
            .prepare(
                `SELECT COUNT(*) AS n FROM messages
                 WHERE type = 'image' AND json_extract(content,'$.status') = 'failed'
                 AND created_at >= ? AND created_at <= ?`
            )
            .get(from, to) as { n: number }
    ).n;

    // 生成类型：高清（prompt 以"高清重制"开头）/ 图生图（有参考图）/ 文生图
    const typeRow = db
        .prepare(
            `SELECT
                SUM(CASE WHEN prompt LIKE '高清重制%' THEN 1 ELSE 0 END) AS hd,
                SUM(CASE WHEN prompt NOT LIKE '高清重制%' AND source_image_id IS NOT NULL THEN 1 ELSE 0 END) AS i2i,
                SUM(CASE WHEN prompt NOT LIKE '高清重制%' AND source_image_id IS NULL THEN 1 ELSE 0 END) AS t2i
             FROM images WHERE ${where}`
        )
        .get(from, to) as { hd: number | null; i2i: number | null; t2i: number | null };
    const byType = { textToImage: typeRow.t2i ?? 0, imageToImage: typeRow.i2i ?? 0, hd: typeRow.hd ?? 0 };

    // 每用户 × 每模型 的明细，用于聚合按模型、按用户、花费
    const rows = db
        .prepare(
            `SELECT COALESCE(u.username,'(已删除)') AS username, COALESCE(i.model,'未知') AS model,
                    COUNT(*) AS count, MAX(i.created_at) AS last_used
             FROM images i LEFT JOIN users u ON u.id = i.user_id
             WHERE i.kind = 'generated' AND i.created_at >= ? AND i.created_at <= ?
             GROUP BY i.user_id, i.model`
        )
        .all(from, to) as { username: string; model: string; count: number; last_used: number }[];

    const modelMap = new Map<string, number>();
    const userMap = new Map<string, AdminStats['byUser'][number]>();
    let totalCost = 0;
    for (const r of rows) {
        const cost = r.count * priceOf(r.model);
        totalCost += cost;
        modelMap.set(r.model, (modelMap.get(r.model) ?? 0) + r.count);
        let u = userMap.get(r.username);
        if (!u) {
            u = { username: r.username, count: 0, cost: 0, lastUsed: 0, models: [] };
            userMap.set(r.username, u);
        }
        u.count += r.count;
        u.cost += cost;
        u.lastUsed = Math.max(u.lastUsed, r.last_used);
        u.models.push({ model: r.model, count: r.count });
    }
    const byModel = [...modelMap.entries()]
        .map(([model, count]) => ({ model, count, cost: count * priceOf(model) }))
        .sort((a, b) => b.count - a.count);
    const byUser = [...userMap.values()].sort((a, b) => b.count - a.count);
    byUser.forEach((u) => u.models.sort((a, b) => b.count - a.count));

    const byDay = db
        .prepare(
            `SELECT date(created_at/1000,'unixepoch','localtime') AS day, COUNT(*) AS count
             FROM images WHERE ${where} GROUP BY day ORDER BY day`
        )
        .all(from, to) as { day: string; count: number }[];

    const spanDays = Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)));
    const avgPerDay = Math.round((total / spanDays) * 10) / 10;

    return c.json({
        total,
        totalCost: Math.round(totalCost * 1000) / 1000,
        activeUsers: userMap.size,
        avgPerDay,
        failed,
        byType,
        byModel,
        byUser,
        byDay,
    } satisfies AdminStats);
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

function updateMessageContent(messageId: string, content: unknown): void {
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(JSON.stringify(content), messageId);
}

// 进行中的生成任务：消息 id → AbortController，用于「停止生成」
const activeGenerations = new Map<string, AbortController>();

// 后台生成：先插入一条"生成中"的图片消息并立刻返回，生成在后台继续，
// 完成/失败后更新这条消息——用户切换页面、换会话、刷新都不影响生成
function startGeneration(opts: {
    userId: string;
    conversationId: string;
    promptCn: string;
    promptEn: string;
    selected?: Record<string, string[]>;
    sourceImageId?: string;
    // 用户选择的生图模型 id（realistic / fast）
    modelId?: string;
}): Message {
    const spec = resolveImageModel(opts.modelId);
    const model = spec.model;
    const imageId = randomUUID();
    const base = {
        imageId,
        prompt: opts.promptCn,
        promptEn: opts.promptEn,
        sourceImageId: opts.sourceImageId,
    };
    const message = insertMessage(opts.conversationId, 'assistant', 'image', { ...base, status: 'pending' });
    const controller = new AbortController();
    activeGenerations.set(message.id, controller);

    void (async () => {
        try {
            let source: { bytes: Uint8Array; contentType: string } | undefined;
            if (opts.sourceImageId) {
                source = (await loadSourceImage(opts.sourceImageId)) ?? undefined;
                if (!source) throw new Error('参考图不存在或文件丢失');
            }

            const { bytes, contentType } = await generateImage(
                opts.promptEn,
                source,
                { api: spec.api, model: spec.model, size: spec.size },
                controller.signal
            );
            const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'png';
            const r2Key = `images/${opts.userId}/${opts.conversationId}/${imageId}.${ext}`;
            await storage.put(r2Key, bytes, contentType);

            db.prepare(
                `INSERT INTO images (id, user_id, conversation_id, message_id, kind, r2_key, content_type, prompt, prompt_en, keywords, source_image_id, model, created_at)
                 VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                imageId,
                opts.userId,
                opts.conversationId,
                message.id,
                r2Key,
                contentType,
                opts.promptCn,
                opts.promptEn,
                opts.selected ? JSON.stringify(opts.selected) : null,
                opts.sourceImageId ?? null,
                model,
                now()
            );

            // 生成成功才计入关键词统计
            if (opts.selected) {
                const insertUsage = db.prepare(
                    'INSERT INTO keyword_usages (id, user_id, conversation_id, image_id, group_name, word, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                for (const [group, words] of Object.entries(opts.selected)) {
                    for (const word of words) {
                        insertUsage.run(randomUUID(), opts.userId, opts.conversationId, imageId, group, word, now());
                    }
                }
            }

            updateMessageContent(message.id, base);
        } catch (err) {
            const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
            if (aborted) {
                updateMessageContent(message.id, { ...base, status: 'failed', error: '已停止生成' });
            } else {
                console.error('生成失败:', err);
                updateMessageContent(message.id, {
                    ...base,
                    status: 'failed',
                    error: err instanceof Error ? err.message : '生成失败',
                });
            }
        } finally {
            activeGenerations.delete(message.id);
        }
    })();

    return message;
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
    const { text, sourceImageId, modelId } = await c.req.json<{
        text: string;
        sourceImageId?: string;
        modelId?: string;
    }>();
    if (!text?.trim()) return c.json({ error: '内容不能为空' }, 400);

    const history = buildHistory(conversationId);
    const userMessage = insertMessage(conversationId, 'user', 'text', { text: text.trim() });

    // 第一条消息顺便当会话标题
    if (history.length === 0) {
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(text.trim().slice(0, 20), conversationId);
    }

    const hasImage = lastImageId(conversationId) !== undefined;
    let plan = await planTurn(history, text.trim());

    // 不是画图需求 → 只回复文字，不生成图片
    if (plan.mode === 'chat') {
        const replyMessage = insertMessage(conversationId, 'assistant', 'text', { text: plan.reply });
        return c.json({ messages: [userMessage, replyMessage] });
    }

    // 会话里还没生成过图片时，画新图一律先走关键词挑选（把 direct 转为 keywords）
    if (plan.mode === 'direct' && !hasImage) {
        plan = await summarizeKeywords(history, text.trim());
    }

    // 指令明确：跳过关键词挑选，直接生成
    if (plan.mode === 'direct') {
        const source = sourceImageId ?? (plan.useLastImage ? lastImageId(conversationId) : undefined);
        const replyMessage = insertMessage(conversationId, 'assistant', 'text', { text: plan.reply });
        const imageMessage = startGeneration({
            userId,
            conversationId,
            promptCn: text.trim(),
            promptEn: plan.promptEn,
            sourceImageId: source,
            modelId,
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
    const imageMessage = startGeneration({
        userId,
        conversationId,
        promptCn: selectedSummary,
        promptEn,
        selected: body.selected,
        sourceImageId: body.sourceImageId,
        modelId: body.modelId,
    });

    return c.json({ messages: [userMessage, imageMessage] });
});

// ---------- 停止生成 ----------
app.post('/api/conversations/:id/cancel', async (c) => {
    const conversationId = c.req.param('id');
    ownedConversation(c.get('userId'), conversationId);
    const { messageId } = await c.req.json<{ messageId: string }>();
    const controller = activeGenerations.get(messageId);
    if (controller) controller.abort();
    // 立即把这条消息标记为已停止，前端马上更新（后台任务也会走 aborted 分支）
    const row = db.prepare('SELECT content FROM messages WHERE id = ? AND conversation_id = ?').get(
        messageId,
        conversationId
    ) as { content: string } | undefined;
    if (row) {
        const content = JSON.parse(row.content);
        if (content.status === 'pending') {
            updateMessageContent(messageId, { ...content, status: 'failed', error: '已停止生成' });
        }
    }
    return c.json({ ok: true });
});

// ---------- 可选的生图模型列表 ----------
app.get('/api/models', (c) => {
    return c.json({
        models: config.ai.imageModels.map((m) => ({ id: m.id, label: m.label })),
        defaultModelId: config.ai.defaultModelId,
    });
});

// ---------- 关键词统计：所有用户选过的关键词按使用次数排行 ----------
app.get('/api/keywords/stats', (c) => {
    const rows = db
        .prepare(
            `SELECT group_name, word, COUNT(*) AS count, MAX(created_at) AS last_used
             FROM keyword_usages GROUP BY group_name, word
             ORDER BY count DESC, last_used DESC LIMIT 500`
        )
        .all() as { group_name: string; word: string; count: number; last_used: number }[];
    const total = (db.prepare('SELECT COUNT(*) AS n FROM keyword_usages').get() as { n: number }).n;
    const stats: KeywordStat[] = rows.map((r) => ({
        group: r.group_name,
        word: r.word,
        count: r.count,
        lastUsed: r.last_used,
    }));
    return c.json({ stats, total });
});

// ---------- 高清重生成：以某张图为参考，用 HD 模型按原提示词重制 ----------
app.post('/api/conversations/:id/hd', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    ownedConversation(userId, conversationId);
    const { imageId } = await c.req.json<{ imageId: string }>();

    const row = db.prepare('SELECT id, prompt, prompt_en FROM images WHERE id = ?').get(imageId) as
        | { id: string; prompt: string | null; prompt_en: string | null }
        | undefined;
    if (!row) return c.json({ error: '图片不存在' }, 404);

    const promptEn = `Recreate this exact image faithfully with much finer detail, sharp focus, crisp clean edges and higher fidelity. Keep the composition, subjects and colors unchanged. ${
        row.prompt_en ?? ''
    }`.trim();
    const message = startGeneration({
        userId,
        conversationId,
        promptCn: `高清重制：${row.prompt ?? ''}`,
        promptEn,
        sourceImageId: row.id,
        modelId: 'realistic',
    });
    return c.json({ messages: [message] });
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
