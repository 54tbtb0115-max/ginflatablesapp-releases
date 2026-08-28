import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        // 开发时前端 5173，API 请求转发给本地 Node 服务
        proxy: {
            '/api': 'http://localhost:8787',
        },
    },
});
