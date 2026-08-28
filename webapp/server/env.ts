import 'dotenv/config';

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`缺少环境变量 ${name}，请检查 .env（可参考 .env.example）`);
    return v;
}

export const config = {
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? 'data/app.db',
    ai: {
        baseUrl: (process.env.AI_BASE_URL ?? 'https://aiberm.com').replace(/\/$/, ''),
        apiKey: required('AI_API_KEY'),
        textModel: process.env.TEXT_MODEL ?? 'google/gemini-2.5-flash',
        imageModel: process.env.IMAGE_MODEL ?? 'gemini-2.5-flash-image',
        // 输出分辨率（1K/2K/4K），仅 gemini-3-pro-image 系列支持；留空则用模型默认
        imageSize: process.env.IMAGE_SIZE || null,
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
