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
- prompt：结合对话上下文写出完整、具体的英文提示词；如果是修改上一张图，写成对那张图的英文编辑指令（例如 "Make the inflatable castle much larger, filling most of the frame..."）；prompt 末尾固定加上清晰度关键词：sharp focus, highly detailed, crisp clean edges
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

const PROMPT_REFINE_SYSTEM = `You turn Chinese image keywords into one English prompt for an image generation model. Output ONLY the prompt text, no quotes, no explanations. Be concrete and visual; include subject, scene, style, lighting, composition. If the request is based on a reference image, phrase it as an edit instruction of that image. Always end the prompt with quality keywords: sharp focus, highly detailed, crisp clean edges, professional quality. Keep it under 130 words.`;

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

// 文生图 / 图生图统一入口：带 source 即为图生图（Gemini 的图像编辑模式）
// override 用于「高清重生成」等场景临时切换模型/分辨率
export async function generateImage(
    promptEn: string,
    source?: { bytes: Uint8Array; contentType: string },
    override?: { model?: string; imageSize?: string | null }
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const model = override?.model ?? config.ai.imageModel;
    const imageSize = override ? override.imageSize ?? null : config.ai.imageSize;

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
