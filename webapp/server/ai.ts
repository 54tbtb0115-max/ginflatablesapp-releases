// AI 调用封装：通过 API 中转平台（如 Aiberm）调 Gemini
// - 关键词总结 / prompt 润色：OpenAI 兼容接口 /v1/chat/completions
// - 文生图 / 图生图：Gemini 原生接口 /v1beta/models/{model}:generateContent
//   （图生图 = 把参考图作为 inline_data 一起传给图像模型）

import type { KeywordGroup } from '../shared/types';
import { config } from './env';

export type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const PLAN_SYSTEM_PROMPT = `你是一个 AI 绘画助手。用户发来一条消息后，你要结合本次对话的上下文判断怎么响应，并且必须只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块）。有三种情况：

情况 C（chat，只聊天不画图）——最优先判断：当用户这条消息并不是要生成或修改图片时，一律用这种，绝不生成图片。典型例子：打招呼、道谢、闲聊、提问、发的是命令或代码、无意义文字、明确表示"不用生成了/停一下/不画了"、或在讨论而非下达绘图指令。
输出格式：{"mode": "chat", "reply": "一句自然的中文回应"}

情况 A（direct，直接生成）：用户明确要求生成或修改图片，且指令已经足够明确。典型例子：对上一张图的修改（"再大一点""改成夜晚""换成红色""去掉背景里的人"）、要求很具体的完整画面描述、指出上一张图漏掉或画错了某个要素要求重画（"充气拱门呢""你没画拱门"）、以及你上一轮已经答应要生成/重新设计之后用户的催促或确认（"好""可以""开始吧""做好了吗""生成吧"）——这些都要立刻用 direct 真正出图，不能只用文字回应。
输出格式：{"mode": "direct", "reply": "一句简短的中文回应，说明你要做什么", "prompt": "完整的英文绘画提示词", "useLastImage": true 或 false}
- prompt：结合对话上下文写出完整、具体的英文提示词，风格为真实照片而非营销渲染图。除非用户明确要求卡通/插画风，否则遵循纪实写实公式：以 "Wide/Close-up documentary photograph of ..." 开头，用自然光和真实材质质感，结尾加 "Realistic photography, sharp detail"，并在不与需求冲突时补上 no readable text, no logos（画面本就没有人物时才加 no visible faces；用户想要人物则保留并描述自然的姿态）；如果是修改上一张图，写成对那张图的英文编辑指令（例如 "Make the inflatable castle much larger..."）
- useLastImage：这次生成是否应该基于上一张图片修改（对已有图微调 = true；画全新的画面 = false）

情况 B（keywords，需要细化）：仅当用户想画全新画面、但描述非常模糊（比如只说"画个城堡""来张海报"这种缺主体/场景/风格信息的），才用关键词让用户挑选来补全。只要用户已经把想要的画面说清楚了（哪怕是新画面），就不要用 keywords，直接用 direct 出图，忠实按用户说的来。
输出格式：{"mode": "keywords", "reply": "一句简短的中文回应", "groups": [{"name": "场景", "options": ["...", "..."]}, {"name": "主体", "options": ["..."]}, {"name": "风格", "options": ["..."]}, {"name": "光线", "options": ["..."]}, {"name": "构图", "options": ["..."]}]}
- 分组固定为：场景、主体、风格、光线、构图；每组 2-5 个简短中文词组选项；用户明确提到的内容放在对应组最前面

判断原则：先判断是不是画图需求——不是就用 chat；是画图需求时，只要指令说得清楚（无论是改图还是画新图）就一律 direct 直接出图，忠实还原用户所说，不要自作主张加风格或元素；只有描述确实太模糊、缺关键信息时才用 keywords。
铁律：chat 模式只是聊天，系统不会生成任何图片，所以 chat 的 reply 里绝不能出现"马上为您生成""正在重新设计""请稍候"这类承诺；只要你打算生成或重画，就必须用 direct 并给出 prompt。`;

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

// 精确模式：用户这类措辞说明要“完全照做”，此时跳过 planner 的风格改写与关键词步骤，忠实执行
export const FAITHFUL_HINT =
    /(严格|精确|精准|准确|完全按照|完全按|照着做|照原|一模一样|原封不动|原样|只(改|把|保留|替换|修改|需要|想要|要)|仅(改|保留|替换|需要)|不要(改|动|额外|自行|发挥|创作|添加|增加|多)|别(改|动|额外|发挥|加)|保持[^，。]*不(变|动)|其(他|余)[^，。]*不(变|动)|exact|exactly|only change|do not change|keep [^,.]* unchanged|as[- ]?is)/i;

// 忠实翻译：把用户指令原样译成英文，不加任何风格或额外细节
const FAITHFUL_TRANSLATE_SYSTEM = `You convert a user's image instruction (usually Chinese) into a concise English instruction for an image generation / editing model.
STRICT RULES:
- Translate ONLY what the user actually said. Do NOT add any style, lighting, mood, camera, composition, background, color, or quality words the user did not mention.
- Do NOT turn it into a "documentary photograph" or impose any style of your own.
- If the user restricts the change to a specific part, or says to keep the rest unchanged, state that constraint explicitly.
- Preserve the user's exact intent and any references to "image 1 / image 2 / the reference / the previous image".
Output ONLY the English instruction, no quotes, no explanation.`;

// 有参考图时追加的硬约束：只改要求的部分，其余保持不变
const FAITHFUL_EDIT_GUARD =
    ' Strictly follow the instruction. Only modify what is explicitly requested; keep every other part of the provided image(s) exactly unchanged. Do not add, remove, restyle, recolor, or reinvent anything that was not asked for.';

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

// 注意：gemini-2.5-flash 经 OpenAI 兼容接口调用时，模型内部的思考(reasoning)token 也计入 max_tokens，
// 实测一次判断要吃掉 600-1000 个思考 token，之前的 1024 经常把 JSON 正文截断（finish_reason=length）→「模型未返回 JSON」。
const TEXT_MAX_TOKENS = 4096;
const TEXT_MAX_TOKENS_RETRY = 8192;

async function runTextModel(system: string, history: HistoryEntry[], user: string): Promise<string> {
    let lastContent = '';
    for (const maxTokens of [TEXT_MAX_TOKENS, TEXT_MAX_TOKENS_RETRY]) {
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
                max_tokens: maxTokens,
            }),
        });
        if (!res.ok) throw new Error(`文本模型请求失败（${res.status}）：${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as {
            choices?: { message?: { content?: string }; finish_reason?: string }[];
            usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
        };
        const choice = data.choices?.[0];
        const content = choice?.message?.content ?? '';
        if (choice?.finish_reason === 'length') {
            console.warn(
                `文本模型输出被截断（max_tokens=${maxTokens}，completion=${data.usage?.completion_tokens}，reasoning=${data.usage?.completion_tokens_details?.reasoning_tokens}），重试`
            );
            lastContent = content;
            continue;
        }
        if (!content) throw new Error('文本模型没有返回内容');
        return content;
    }
    throw new Error(`文本模型输出被截断（思考 token 过多）: ${lastContent.slice(0, 120)}`);
}

export type TurnPlan =
    | { mode: 'chat'; reply: string }
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
export async function summarizeKeywords(
    history: HistoryEntry[],
    userText: string
): Promise<{ mode: 'keywords'; reply: string; groups: KeywordGroup[] }> {
    const raw = await runTextModel(KEYWORD_ONLY_PROMPT, history, userText);
    const parsed = extractJson(raw) as { reply?: string; groups?: { name?: string; options?: unknown[] }[] };
    const groups = parseKeywordGroups(parsed);
    if (groups.length === 0) throw new Error('关键词解析失败');
    return { mode: 'keywords', reply: String(parsed.reply ?? '这是我总结的关键词，请挑选后生成。'), groups };
}

// 已有图片后用：判断这轮该直接生成还是给出关键词供挑选
const PROMISE_PATTERN = /(马上|立刻|正在|稍候|稍等|重新设计|重新生成|为您生成|为你生成|为您重新|为你重新|开始生成)/;

const FORCE_DIRECT_SUFFIX = `

【补充指令】刚才你在 chat 模式里承诺了要生成/重新设计图片，但 chat 模式不会出图。用户就是要图，这次必须输出 direct 模式，并结合对话上下文（包括用户指出的遗漏要素）写出完整的英文 prompt。`;

const JSON_ONLY_SUFFIX = `

【补充指令】你上一次的回答没有按要求输出 JSON（把话直接说了出来，或者模仿了对话记录里"[已生成图片，提示词：...]"的写法）。对话记录里方括号包起来的内容只是系统给你看的备注，不是你该输出的格式。这次必须只输出一个 JSON 对象，不要任何其他文字。`;

// 模型偶尔不按 JSON 回答（常见于模仿了历史记录里的备注格式）：兜底从"提示词：xxx"里抠出 prompt 当作 direct
function salvagePlan(raw: string): TurnPlan | null {
    const m = raw.match(/提示词[：:]\s*([^\]\n]{20,})/);
    if (!m) return null;
    const reply = raw.split(/[\[\n]/)[0].trim() || '好的，马上生成。';
    console.warn('planTurn: 模型未返回 JSON，从文本中抠出提示词兜底生成');
    return { mode: 'direct', reply, promptEn: m[1].trim().replace(/[\]"'。]+$/, ''), useLastImage: true };
}

export async function planTurn(history: HistoryEntry[], userText: string, forced = false, jsonRetried = false): Promise<TurnPlan> {
    let system = PLAN_SYSTEM_PROMPT;
    if (forced) system += FORCE_DIRECT_SUFFIX;
    if (jsonRetried) system += JSON_ONLY_SUFFIX;
    const raw = await runTextModel(system, history, userText);
    let parsedUnknown: unknown;
    try {
        parsedUnknown = extractJson(raw);
    } catch (err) {
        if (!jsonRetried) {
            console.warn('planTurn: 模型未返回 JSON，追加只输出 JSON 的指令重问一次');
            return planTurn(history, userText, forced, true);
        }
        const salvaged = salvagePlan(raw);
        if (salvaged) return salvaged;
        throw err;
    }
    const parsed = parsedUnknown as {
        mode?: string;
        reply?: string;
        prompt?: string;
        useLastImage?: boolean;
        groups?: { name?: string; options?: unknown[] }[];
    };

    if (parsed.mode === 'chat' && !parsed.prompt && !parsed.groups) {
        const reply = String(parsed.reply ?? '好的。');
        // 模型偶尔会在 chat 模式里口头答应"马上生成/重新设计"却不给 prompt，结果永远不出图。
        // 这种情况再问一次，强制它给出 direct 计划。
        if (!forced && PROMISE_PATTERN.test(reply)) {
            console.warn('planTurn: chat 回复承诺了生成但没给 prompt，改为强制 direct 重问');
            return planTurn(history, userText, true, jsonRetried);
        }
        return { mode: 'chat', reply };
    }

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

// 精确模式：把用户指令忠实翻成英文（不加风格、不额外发挥）；有参考图时追加“只改要求处”的硬约束
export async function faithfulPrompt(
    history: HistoryEntry[],
    userText: string,
    hasSource: boolean
): Promise<string> {
    const en = (await runTextModel(FAITHFUL_TRANSLATE_SYSTEM, history, userText))
        .trim()
        .replace(/^["'\s]+|["'\s]+$/g, '');
    return hasSource ? `${en}${FAITHFUL_EDIT_GUARD}` : en;
}

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; data?: string };
};

export type ImageSource = { bytes: Uint8Array; contentType: string };

// 文生图 / 图生图统一入口：带参考图即为图生图（支持多张：图一参考、图二画布等）
// spec 指定用哪个模型（接口风格、模型名、尺寸）
export async function generateImage(
    promptEn: string,
    sources: ImageSource[],
    spec: { api: 'gemini' | 'openai'; model: string; size: string | null },
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const { model, size } = spec;

    if (spec.api === 'openai') {
        // OpenAI 图像编辑接口只接受一张底图，取最后一张（约定为“画布/主图”）
        return generateImageOpenAI(model, size, promptEn, sources[sources.length - 1], signal);
    }

    const imageSize = size;
    // 多图时明确告诉模型每张图的顺序（Image 1 / Image 2 …），便于“图一是参考、在图二上改”这类指令
    const leadText =
        sources.length > 1
            ? `You are given ${sources.length} images below, in order: ${sources
                  .map((_, i) => `Image ${i + 1}`)
                  .join(', ')}. Follow the instruction about which image is the reference and which is the one to edit. ${promptEn}`
            : promptEn;
    const parts: unknown[] = [{ text: leadText }];
    for (const source of sources) {
        parts.push({
            inline_data: { mime_type: source.contentType, data: Buffer.from(source.bytes).toString('base64') },
        });
    }

    const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
    if (imageSize) generationConfig.imageConfig = { imageSize };

    const res = await fetch(`${config.ai.baseUrl}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: apiHeaders(),
        signal,
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
    source?: { bytes: Uint8Array; contentType: string },
    signal?: AbortSignal
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
        res = await fetch(`${config.ai.baseUrl}/v1/images/edits`, { method: 'POST', headers: auth, body: form, signal });
    } else {
        res = await fetch(`${config.ai.baseUrl}/v1/images/generations`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: promptEn, size, n: 1 }),
            signal,
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
