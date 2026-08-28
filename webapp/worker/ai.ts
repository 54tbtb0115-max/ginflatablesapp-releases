// Workers AI 调用封装：关键词总结、提示词润色、文生图、图生图

import type { KeywordGroup } from '../shared/types';

export type Env = {
    DB: D1Database;
    BUCKET: R2Bucket;
    AI: Ai;
    ASSETS: Fetcher;
    TEXT_MODEL: string;
    T2I_MODEL: string;
    I2I_MODEL: string;
};

export type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const KEYWORD_SYSTEM_PROMPT = `你是一个 AI 绘画助手。用户会用中文描述想要生成的画面，你要结合本次对话的上下文，把描述总结成可勾选的关键词，供用户挑选后交给绘画模型。

必须只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块。格式：
{"reply": "一句简短的中文回应，说明你的理解", "groups": [{"name": "场景", "options": ["...", "..."]}, {"name": "主体", "options": ["..."]}, {"name": "风格", "options": ["..."]}, {"name": "光线", "options": ["..."]}, {"name": "构图", "options": ["..."]}]}

要求：
- 分组固定为：场景、主体、风格、光线、构图；某组没有信息时给出 2-3 个合理的推荐选项
- 每组 2-5 个选项，选项是简短的中文词组
- 用户描述里明确提到的内容放在对应组的最前面
- 如果用户是在修改之前的图（例如"改成夜晚"），保留之前的关键词，只更新变化的部分`;

const PROMPT_REFINE_SYSTEM = `You turn Chinese image keywords into one English prompt for a diffusion image model (Flux / Stable Diffusion). Output ONLY the prompt text, no quotes, no explanations. Be concrete and visual; include subject, scene, style, lighting, composition, and quality tags. Keep it under 120 words.`;

function extractJson(text: string): unknown {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`LLM 未返回 JSON: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(start, end + 1));
}

async function runTextModel(env: Env, system: string, history: HistoryEntry[], user: string): Promise<string> {
    const messages = [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: user },
    ];
    const result = (await env.AI.run(env.TEXT_MODEL as keyof AiModels, { messages, max_tokens: 1024 } as never)) as {
        response?: string;
    };
    if (!result?.response) throw new Error('文本模型没有返回内容');
    return result.response;
}

export async function summarizeKeywords(
    env: Env,
    history: HistoryEntry[],
    userText: string
): Promise<{ reply: string; groups: KeywordGroup[] }> {
    const raw = await runTextModel(env, KEYWORD_SYSTEM_PROMPT, history, userText);
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

export async function refinePrompt(env: Env, keywordSummary: string, note: string | undefined): Promise<string> {
    const user = `Keywords: ${keywordSummary}${note ? `\nExtra notes: ${note}` : ''}`;
    const text = await runTextModel(env, PROMPT_REFINE_SYSTEM, [], user);
    return text.replace(/^["'\s]+|["'\s]+$/g, '');
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// 不同生图模型返回格式不同：flux 返回 { image: base64 }，SD 系列返回二进制流
async function normalizeImageResult(result: unknown): Promise<Uint8Array> {
    if (result instanceof ReadableStream) {
        return new Uint8Array(await new Response(result).arrayBuffer());
    }
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    if (result instanceof Uint8Array) return result;
    const image = (result as { image?: string })?.image;
    if (typeof image === 'string') return base64ToBytes(image);
    throw new Error('生图模型返回了无法识别的格式');
}

export async function textToImage(env: Env, promptEn: string): Promise<Uint8Array> {
    const result = await env.AI.run(env.T2I_MODEL as keyof AiModels, { prompt: promptEn, steps: 8 } as never);
    return normalizeImageResult(result);
}

export async function imageToImage(
    env: Env,
    promptEn: string,
    sourceImage: Uint8Array,
    strength: number
): Promise<Uint8Array> {
    const result = await env.AI.run(env.I2I_MODEL as keyof AiModels, {
        prompt: promptEn,
        image: Array.from(sourceImage),
        strength,
        num_steps: 20,
    } as never);
    return normalizeImageResult(result);
}
