import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { app } from './app';
import { config } from './env';
import { storage } from './storage';

// 生产模式：同时托管打包后的前端（先 npm run build 生成 dist/）
if (existsSync('dist/index.html')) {
    app.use('/*', serveStatic({ root: './dist' }));
    // SPA 路由回退（/gallery 等前端路由刷新时返回 index.html）
    app.get('*', serveStatic({ path: './dist/index.html' }));
} else {
    console.log('未找到 dist/（开发模式）：前端请用 vite dev 访问 http://localhost:5173');
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`服务已启动：http://0.0.0.0:${info.port}（内网用户访问 http://<服务器IP>:${info.port}）`);
    console.log(`图片存储：${storage.kind === 'r2' ? `Cloudflare R2（${config.r2?.bucket}）` : '本地磁盘（未配置 R2）'}`);
});
