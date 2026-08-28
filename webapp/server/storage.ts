// 图片存储：优先 Cloudflare R2（S3 兼容接口）；未配置 R2 时退回本地磁盘（离线调试用）

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { config } from './env';

export interface Storage {
    readonly kind: 'r2' | 'local';
    put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
    get(key: string): Promise<Uint8Array | null>;
}

function r2Storage(r2: NonNullable<typeof config.r2>): Storage {
    const client = new S3Client({
        region: 'auto',
        endpoint: r2.endpoint,
        credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    });
    return {
        kind: 'r2',
        async put(key, bytes, contentType) {
            await client.send(
                new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: bytes, ContentType: contentType })
            );
        },
        async get(key) {
            try {
                const res = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
                return res.Body ? await res.Body.transformToByteArray() : null;
            } catch (err) {
                if ((err as { name?: string }).name === 'NoSuchKey') return null;
                throw err;
            }
        },
    };
}

function localStorage(dir: string): Storage {
    const safePath = (key: string) => {
        const p = normalize(join(dir, key));
        if (!p.startsWith(normalize(dir))) throw new Error('非法的存储 key');
        return p;
    };
    return {
        kind: 'local',
        async put(key, bytes) {
            const p = safePath(key);
            mkdirSync(dirname(p), { recursive: true });
            await writeFile(p, bytes);
        },
        async get(key) {
            try {
                return new Uint8Array(await readFile(safePath(key)));
            } catch (err) {
                if ((err as { code?: string }).code === 'ENOENT') return null;
                throw err;
            }
        },
    };
}

export const storage: Storage = config.r2 ? r2Storage(config.r2) : localStorage(config.localStorageDir);
