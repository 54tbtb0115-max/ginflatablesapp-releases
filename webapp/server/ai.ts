// AI 调用封装：通过 API 中转平台（如 Aiberm）调 Gemini
// - 关键词总结 / prompt 润色：OpenAI 兼容接口 /v1/chat/completions
// - 文生图 / 图生图：Gemini 原生接口 /v1beta/models/{model}:generateContent
//   （图生图 = 把参考图作为 inline_data 一起传给图像模型）

import type { KeywordGroup } from '../shared/types';
import { config } from './env';

export type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const KEYWORD_SYSTEM_PROMPT = `你是一个 AI 绘画助手。用户会用中文描述想要生成的画面，你要结合本次对话的上下文，把描述总结成可勾选的关键词，供用户挑选后交给绘画模型。

必须只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块。格式：
{"reply": "一句简短的中文回应，说明你的理解", "groups": [{"name": "场景", "options": ["...", "..."]}, {"name": "主体", "options": ["..."]}, {"name": "风格", "options": ["..."]}, {"name": "光线", "options": ["..."]}, {"name": "构图", "options": ["..."]}]}

要求：
- 分组固定为：场景、主体、风格、光线、构图；某组没有信息时给出 2-3 个合理的推荐选项
- 每组 2-5 个选项，选项是简短的中文词组
- 用户描述里明确提到的内容放在对应组的最前面
- 如果用户是在修改之前的图（例如"改成夜晚"），保留之前的关键词，只更新变化的部分`;

const PROMPT_REFINE_SYSTEM = `You turn Chinese image keywords into one English prompt for an image generation model. Output ONLY the prompt text, no quotes, no explanations. Be concrete and visual; include subject, scene, style, lighting, composition. If the request is based on a reference image, phrase it as an edit instruction of that image. Keep it under 120 words.`;

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

export async function summarizeKeywords(
    history: HistoryEntry[],
    userText: string
): Promise<{ reply: string; groups: KeywordGroup[] }> {
    const raw = await runTextModel(KEYWORD_SYSTEM_PROMPT, history, userText);
    const parsed = extractJson(raw) as { reply?: string; groups?: { name?: string; options?: unknown[] }[] };
    const groups: KeywordGroup[] = (parsed.groups ?? [])
        .map((g) => ({
            name: String(g.name ?? '').trim(),
            options: (g.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6),
        }))
        .filter((g) => g.name && g.options.length > 0);
    if (groups.length === 0) throw new Error('关键词解析失败');
    return { reply: String(parsed.reply ?? '这是我总结的关键词，请挑选后生成。'), groups };
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
export async function generateImage(
    promptEn: string,
    source?: { bytes: Uint8Array; contentType: string }
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const parts: unknown[] = [{ text: promptEn }];
    if (source) {
        parts.push({
            inline_data: { mime_type: source.contentType, data: Buffer.from(source.bytes).toString('base64') },
        });
    }

    const res = await fetch(`${config.ai.baseUrl}/v1beta/models/${config.ai.imageModel}:generateContent`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
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
