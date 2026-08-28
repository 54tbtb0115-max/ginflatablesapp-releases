// AI 调用封装：通过 API 中转平台（如 Aiberm）调 Gemini
// - 关键词总结 / prompt 润色：OpenAI 兼容接口 /v1/chat/completions
// - 文生图 / 图生图：Gemini 原生接口 /v1beta/models/{model}:generateContent
//   （图生图 = 把参考图作为 inline_data 一起传给图像模型）

import type { KeywordGroup } from '../shared/types';
import { config } from './env';

export type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const PLAN_SYSTEM_PROMPT = `你是一个 AI 绘画助手。用户发来一条消息后，你要结合本次对话的上下文判断怎么响应，并且必须只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块）。有两种情况：

情况 A（direct，直接生成）——优先选这种：用户的指令已经足够明确，不需要再挑选关键词。典型例子：对上一张图的修改（"再大一点""改成夜晚""换成红色""去掉背景里的人"）、要求很具体的完整描述、或用户明显希望直接出图。
输出格式：{"mode": "direct", "reply": "一句简短的中文回应，说明你要做什么", "prompt": "完整的英文绘画提示词", "useLastImage": true 或 false}
- prompt：结合对话上下文写出完整、具体的英文提示词，风格为真实照片而非营销渲染图。除非用户明确要求卡通/插画风，否则遵循纪实写实公式：以 "Wide/Close-up documentary photograph of ..." 开头，用自然光和真实材质质感，结尾加 "Realistic photography, sharp detail"，并在不与需求冲突时补上 no readable text, no logos（画面本就没有人物时才加 no visible faces；用户想要人物则保留并描述自然的姿态）；如果是修改上一张图，写成对那张图的英文编辑指令（例如 "Make the inflatable castle much larger..."）
- useLastImage：这次生成是否应该基于上一张图片修改（对已有图微调 = true；画全新的画面 = false）

情况 B（keywords，需要细化）：用户在描述一个全新的画面，信息还比较模糊、值得让用户挑选关键词来细化时才用。
输出格式：{"mode": "keywords", "reply": "一句简短的中文回应", "groups": [{"name": "场景", "options": ["...", "..."]}, {"name": "主体", "options": ["..."]}, {"name": "风格", "options": ["..."]}, {"name": "光线", "options": ["..."]}, {"name": "构图", "options": ["..."]}]}
- 分组固定为：场景、主体、风格、光线、构图；每组 2-5 个简短中文词组选项；用户明确提到的内容放在对应组最前面

判断原则：对已有图片的修改和细化指令用 direct；描述全新画面时用 keywords。`;

const KEYWORD_ONLY_PROMPT = `你是一个 AI 绘画助手。用户会用中文描述想要生成的画面，你要结合本次对话的上下文，把描述总结成可勾选的关键词，供用户挑选后交给绘画模型。

必须只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块。格式：
{"reply": "一句简短的中文回应，说明你的理解", "groups": [{"name": "场景", "options": ["...", "..."]}, {"name": "主体", "options": ["..."]}, {"name": "风格", "options": ["..."]}, {"name": "光线", "options": ["..."]}, {"name": "构图", "options": ["..."]}]}

要求：
- 分组固定为：场景、主体、风格、光线、构图；某组没有信息时给出 2-3 个合理的推荐选项
- 每组 2-5 个选项，选项是简短的中文词组
- 用户描述里明确提到的内容放在对应组的最前面`;

// 纪实写实风格公式：产品/场景类图片靠这套写法出真实照片效果（参考已验证的高质量产线）
const REALISM_STYLE_GUIDE = `Write it as a realistic photograph, NOT a marketing render or 3D illustration. Follow these rules:
- Begin with "Wide documentary photograph of ..." or "Close-up documentary photograph of ..." depending on framing.
- Use natural lighting (bright daylight / soft daylight through windows), realistic materials and textures, believable real-world setting.
- End with: Realistic photography, sharp detail.
- To avoid AI artifacts, append these negatives WHEN they do not conflict with the request: no readable text, no logos, no flags. Only add "no visible faces" if the scene has NO people the user actually wants; if the user explicitly wants people/children, keep them but describe natural, candid poses.
- Avoid over-saturated cartoon colors, rainbows, and obviously composited elements unless explicitly requested.`;

const PROMPT_REFINE_SYSTEM = `You turn Chinese image keywords into one English prompt for a photo-realistic image generation model. Output ONLY the prompt text, no quotes, no explanations. Include subject, scene, lighting, composition, concisely and vividly. If the request is based on a reference image, phrase it as an edit instruction of that image while keeping the described realistic-photo style. ${REALISM_STYLE_GUIDE} Keep it under 130 words.`;

const apiHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.ai.apiKey}`,
    'x-goog-api-key': config.ai.apiKey,
});

function extractJson(text: string): unknown {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`模型未返回 JSON: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(start, end + 1));
}

async function runTextModel(system: string, history: HistoryEntry[], user: string): Promise<string> {
    const res = await fetch(`${config.ai.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
            model: config.ai.textModel,
            messages: [
                { role: 'system', content: system },
                ...history,
                { role: 'user', content: user },
            ],
            max_tokens: 1024,
        }),
    });
    if (!res.ok) throw new Error(`文本模型请求失败（${res.status}）：${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('文本模型没有返回内容');
    return content;
}

export type TurnPlan =
    | { mode: 'keywords'; reply: string; groups: KeywordGroup[] }
    | { mode: 'direct'; reply: string; promptEn: string; useLastImage: boolean };

function parseKeywordGroups(parsed: { groups?: { name?: string; options?: unknown[] }[] }): KeywordGroup[] {
    return (parsed.groups ?? [])
        .map((g) => ({
            name: String(g.name ?? '').trim(),
            options: (g.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6),
        }))
        .filter((g) => g.name && g.options.length > 0);
}

// 会话首次生成前用：只总结关键词，不做直接生成
export async function summarizeKeywords(history: HistoryEntry[], userText: string): Promise<TurnPlan> {
    const raw = await runTextModel(KEYWORD_ONLY_PROMPT, history, userText);
    const parsed = extractJson(raw) as { reply?: string; groups?: { name?: string; options?: unknown[] }[] };
    const groups = parseKeywordGroups(parsed);
    if (groups.length === 0) throw new Error('关键词解析失败');
    return { mode: 'keywords', reply: String(parsed.reply ?? '这是我总结的关键词，请挑选后生成。'), groups };
}

// 已有图片后用：判断这轮该直接生成还是给出关键词供挑选
export async function planTurn(history: HistoryEntry[], userText: string): Promise<TurnPlan> {
    const raw = await runTextModel(PLAN_SYSTEM_PROMPT, history, userText);
    const parsed = extractJson(raw) as {
        mode?: string;
        reply?: string;
        prompt?: string;
        useLastImage?: boolean;
        groups?: { name?: string; options?: unknown[] }[];
    };

    if (parsed.mode === 'direct' || (parsed.prompt && !parsed.groups)) {
        if (!parsed.prompt) throw new Error('模型未返回提示词');
        return {
            mode: 'direct',
            reply: String(parsed.reply ?? '好的，马上生成。'),
            promptEn: String(parsed.prompt),
            useLastImage: Boolean(parsed.useLastImage),
        };
    }

    const groups = parseKeywordGroups(parsed);
    if (groups.length === 0) throw new Error('关键词解析失败');
    return { mode: 'keywords', reply: String(parsed.reply ?? '这是我总结的关键词，请挑选后生成。'), groups };
}

export async function refinePrompt(keywordSummary: string, note: string | undefined): Promise<string> {
    const user = `Keywords: ${keywordSummary}${note ? `\nExtra notes: ${note}` : ''}`;
    const text = await runTextModel(PROMPT_REFINE_SYSTEM, [], user);
    return text.replace(/^["'\s]+|["'\s]+$/g, '');
}

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; data?: string };
};

// 文生图 / 图生图统一入口：带 source 即为图生图
// spec 指定用哪个模型（接口风格、模型名、尺寸）
export async function generateImage(
    promptEn: string,
    source: { bytes: Uint8Array; contentType: string } | undefined,
    spec: { api: 'gemini' | 'openai'; model: string; size: string | null }
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const { model, size } = spec;

    if (spec.api === 'openai') {
        return generateImageOpenAI(model, size, promptEn, source);
    }

    const imageSize = size;
    const parts: unknown[] = [{ text: promptEn }];
    if (source) {
        parts.push({
            inline_data: { mime_type: source.contentType, data: Buffer.from(source.bytes).toString('base64') },
        });
    }

    const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
    if (imageSize) generationConfig.imageConfig = { imageSize };

    const res = await fetch(`${config.ai.baseUrl}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig,
        }),
    });
    if (!res.ok) throw new Error(`生图请求失败（${res.status}）：${(await res.text()).slice(0, 300)}`);

    const data = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] } }[];
        promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
        throw new Error(`生图请求被拒绝：${data.promptFeedback.blockReason}`);
    }
    for (const part of data.candidates?.[0]?.content?.parts ?? []) {
        const inline = part.inlineData ?? part.inline_data;
        if (inline?.data) {
            const contentType = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png';
            return { bytes: new Uint8Array(Buffer.from(inline.data, 'base64')), contentType };
        }
    }
    const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    throw new Error(`生图模型没有返回图片${text ? `：${text.slice(0, 200)}` : ''}`);
}

// OpenAI 图像接口（gpt-image 等）：文生图走 /v1/images/generations，图生图走 /v1/images/edits
// gpt-image 的写实度明显更好，适合产品实拍类需求
async function generateImageOpenAI(
    model: string,
    imageSize: string | null,
    promptEn: string,
    source?: { bytes: Uint8Array; contentType: string }
): Promise<{ bytes: Uint8Array; contentType: string }> {
    // OpenAI 尺寸格式为 宽x高（如 1024x1024），非 1K/2K；不是该格式则用 auto
    const size = imageSize && /^\d+x\d+$/.test(imageSize) ? imageSize : 'auto';
    const auth = { Authorization: `Bearer ${config.ai.apiKey}` };
    let res: Response;

    if (source) {
        // 图生图：multipart/form-data，不要手动设 Content-Type（让 fetch 自动带 boundary）
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', promptEn);
        form.append('size', size);
        form.append('n', '1');
        form.append('image', new Blob([source.bytes], { type: source.contentType }), 'image.png');
        res = await fetch(`${config.ai.baseUrl}/v1/images/edits`, { method: 'POST', headers: auth, body: form });
    } else {
        res = await fetch(`${config.ai.baseUrl}/v1/images/generations`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: promptEn, size, n: 1 }),
        });
    }

    if (!res.ok) throw new Error(`生图请求失败（${res.status}）：${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (item?.b64_json) {
        return { bytes: new Uint8Array(Buffer.from(item.b64_json, 'base64')), contentType: 'image/png' };
    }
    if (item?.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw new Error(`下载生成的图片失败（${imgRes.status}）`);
        const contentType = imgRes.headers.get('content-type') ?? 'image/png';
        return { bytes: new Uint8Array(await imgRes.arrayBuffer()), contentType };
    }
    throw new Error('生图模型没有返回图片');
}
