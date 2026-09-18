import 'dotenv/config';

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`缺少环境变量 ${name}，请检查 .env（可参考 .env.example）`);
    return v;
}

export const config = {
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? 'data/app.db',
    // 管理员账号（逗号分隔），可访问 /admin 统计页
    adminUsers: (process.env.ADMIN_USERS ?? 'bianca')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    // 各生图模型单价（美元/张），用于统计页估算花费；可用 IMAGE_PRICES（JSON）覆盖
    imagePrices: ((): Record<string, number> => {
        try {
            const p = JSON.parse(process.env.IMAGE_PRICES ?? '');
            if (p && typeof p === 'object') return p;
        } catch {
            /* 用默认 */
        }
        // 2026-09-17 按 aiberm 实际扣费回算：gpt-image-2 按输出 token 计费，quality=high(auto) 时一张 ≈$0.10，
        // medium ≈$0.035；gemini-3-pro 每张固定 ≈$0.045；flash-image ≈$0.02
        return {
            'gpt-image-2': 0.035,
            'gemini-2.5-flash-image': 0.02,
            'gemini-3-pro-image-preview': 0.045,
        };
    })(),
    // 自定义 DNS 服务器（逗号分隔），留空则用系统默认
    dnsServers: (process.env.DNS_SERVERS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    // HTTP(S) 代理地址，如 http://192.168.100.194:7890，留空则直连
    httpsProxy: (process.env.HTTPS_PROXY || process.env.https_proxy || '').trim(),
    ai: {
        baseUrl: (process.env.AI_BASE_URL ?? 'https://aiberm.com').replace(/\/$/, ''),
        apiKey: required('AI_API_KEY'),
        textModel: process.env.TEXT_MODEL ?? 'google/gemini-2.5-flash',
        // 可在发送时选择的生图模型列表；模型名/尺寸可用环境变量覆盖，默认开箱即用
        imageModels: [
            {
                id: 'quality',
                label: '高质量（Gemini 3 Pro）',
                api: 'gemini' as const,
                model: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview',
                size: process.env.GEMINI_IMAGE_SIZE || null,
            },
            {
                id: 'fast',
                label: '快速（Gemini Flash）',
                api: 'gemini' as const,
                model: process.env.GEMINI_FAST_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
                size: process.env.GEMINI_IMAGE_SIZE || null,
            },
        ],
        defaultModelId: process.env.DEFAULT_IMAGE_MODEL ?? 'quality',
        // 局部编辑（标记改图/擦除/扩图/抠图）需要 mask，只能用 gpt-image
        editModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
        // gpt-image 按输出 token 计费，quality 决定一张图吃多少 token：low≈270 / medium≈1000 / high≈4000+
        // 不传时接口默认 auto≈high，一张要 $0.10 左右；默认 medium 够用且便宜 3 倍
        openaiQuality: (process.env.OPENAI_IMAGE_QUALITY ?? 'medium') as 'low' | 'medium' | 'high' | 'auto',
    },
    r2:
        process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET
            ? {
                  endpoint: process.env.R2_ENDPOINT,
                  accessKeyId: process.env.R2_ACCESS_KEY_ID,
                  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
                  bucket: process.env.R2_BUCKET,
              }
            : null,
    localStorageDir: process.env.LOCAL_STORAGE_DIR ?? 'data/images',
};

export type ImageModelSpec = (typeof config.ai.imageModels)[number];

// 按 id 解析选中的生图模型；未指定或找不到时用默认
export function resolveImageModel(id?: string): ImageModelSpec {
    return (
        config.ai.imageModels.find((m) => m.id === id) ??
        config.ai.imageModels.find((m) => m.id === config.ai.defaultModelId) ??
        config.ai.imageModels[0]
    );
}
