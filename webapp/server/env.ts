import 'dotenv/config';

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`缺少环境变量 ${name}，请检查 .env（可参考 .env.example）`);
    return v;
}

export const config = {
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? 'data/app.db',
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
                id: 'realistic',
                label: '写实（gpt-image-2）',
                api: 'openai' as const,
                model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
                size: process.env.OPENAI_IMAGE_SIZE || 'auto',
            },
            {
                id: 'fast',
                label: '快速（Gemini）',
                api: 'gemini' as const,
                model: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
                size: process.env.GEMINI_IMAGE_SIZE || null,
            },
        ],
        defaultModelId: process.env.DEFAULT_IMAGE_MODEL ?? 'realistic',
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
