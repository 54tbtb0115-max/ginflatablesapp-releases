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
    ai: {
        baseUrl: (process.env.AI_BASE_URL ?? 'https://aiberm.com').replace(/\/$/, ''),
        apiKey: required('AI_API_KEY'),
        textModel: process.env.TEXT_MODEL ?? 'google/gemini-2.5-flash',
        imageModel: process.env.IMAGE_MODEL ?? 'gemini-2.5-flash-image',
        // 输出分辨率（1K/2K/4K），仅 gemini-3-pro-image 系列支持；留空则用模型默认
        imageSize: process.env.IMAGE_SIZE || null,
        // 「高清重生成」用的模型与分辨率（按次计费更贵，仅在用户点高清按钮时使用）
        hdImageModel: process.env.HD_IMAGE_MODEL ?? 'gemini-3-pro-image-preview',
        hdImageSize: process.env.HD_IMAGE_SIZE || '2K',
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
