# AI 画室（聊天式文生图 / 图生图，内网部署）

一个部署在内网服务器上的 AI 生图网站，图片存 Cloudflare R2 云端：

1. **文生图**：用户发中文描述 → 关键词 AI 总结出「场景 / 主体 / 风格 / 光线 / 构图」关键词 → 用户勾选（可补充说明）→ 提示词 AI 润色成英文 prompt → 生图 AI 出图
2. **图生图**：上传参考图，或点任意一张历史图的「以此图再创作」，再走同样的关键词流程
3. **连续聊天**：同一会话内的历史消息会作为上下文传给 AI，可以说「把刚才那张改成夜晚的」
4. **图片全部落盘**：图片实体存 **Cloudflare R2**（S3 兼容接口直连），元数据（prompt、关键词、所属会话）存本地 **SQLite**，每张图都是聊天里的一条消息
5. **图库**：`/gallery` 汇集所有用户生成的所有图片，瀑布流 + 游标分页，可查看 prompt、下载、再创作
6. **账号登录**：必须登录才能使用；账号由管理员在服务器上创建分发（不开放注册）；每人只能看到自己的会话，图库全员共享
7. **关键词统计**：`/keywords` 页汇总所有用户生成时选中的关键词，按分组展示使用次数排行，便于整理高频词

界面样式参考 Themesbrand 的 Chatvia Tailwind 模板（violet 主色、Public Sans 字体、左侧图标栏 + 会话列表 + 聊天区布局，支持暗色模式），用 React 重新实现。

## 架构

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + Tailwind CSS + react-router（构建后由 Node 服务托管） |
| 后端 | Node.js 20+ + Hono（单进程，`server/`） |
| 数据库 | SQLite（better-sqlite3，文件在 `data/app.db`） |
| 图片存储 | Cloudflare R2，走 S3 兼容接口（`@aws-sdk/client-s3`）；未配置 R2 时自动退回本地磁盘 `data/images/` |
| AI | 通过 API 中转平台（Aiberm 等）调 **Gemini**：`google/gemini-2.5-flash` 做关键词总结与 prompt 润色（OpenAI 兼容接口），`gemini-2.5-flash-image` 做文生图和图生图（Gemini 原生 `generateContent` 接口） |

内网服务器只需要两条出网通道：中转平台（AI）和 `*.r2.cloudflarestorage.com`（图片）。内网用户浏览器访问的是服务器本身，不需要出网。

用户识别目前是最简方案：首次访问发一个一年期 `uid` cookie 自动建用户。要做真正的登录，替换 `server/app.ts` 里的用户中间件即可。

## 目录结构

```
webapp/
├── server/          # Node 后端
│   ├── index.ts     # 入口：API + 托管前端静态文件
│   ├── app.ts       # 路由：会话 / 消息 / 生图 / 上传 / 图库 / 图片文件
│   ├── ai.ts        # AI 封装：关键词总结、prompt 润色、文生图/图生图
│   ├── storage.ts   # R2（S3 接口）/ 本地磁盘 存储
│   ├── db.ts        # SQLite 初始化（自动执行 schema.sql）
│   └── env.ts       # .env 配置读取
├── src/             # React 前端（ChatPage / GalleryPage / Sidebar）
├── shared/types.ts  # 前后端共用类型
├── schema.sql       # 建表语句（幂等，启动时自动执行）
└── setup.sh         # 一键部署脚本
```

## 部署（内网服务器）

```bash
cd webapp
./setup.sh    # 装依赖 → 按提示填 Aiberm 令牌和 R2 凭据 → 构建
npm start     # 启动，默认 8787 端口；内网用户访问 http://<服务器IP>:8787
```

### 账号管理（在 webapp/ 目录下执行）

```bash
npm run user add 张三 abc123456    # 创建账号（密码至少 6 位），然后把账号发给使用者
npm run user list                  # 列出所有账号及生成数量
npm run user passwd 张三 新密码     # 重置密码
npm run user disable 张三          # 禁用账号（踢下线，历史图片保留）
```

R2 凭据在 Cloudflare 控制台 → R2 → 管理 API 令牌 里创建（权限选"对象读和写"，限定目标桶），会得到端点 URL、Access Key ID、Secret Access Key 三样，对应 `.env` 里的 `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`，桶名填 `R2_BUCKET`。

正式运行建议用 pm2 或 systemd 守护进程；所有配置都在 `.env`（参考 `.env.example`），**`.env` 和 `data/` 已被 .gitignore 忽略，不要提交**。

## 本地开发

```bash
npm install
cp .env.example .env   # 填入配置；R2 四项留空则图片存本地磁盘
npm run dev            # 后端 8787 + 前端 5173（vite 代理 /api），打开 http://localhost:5173
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/conversations` | 会话列表 / 新建会话 |
| GET | `/api/conversations/:id/messages` | 会话消息（含图片消息） |
| POST | `/api/conversations/:id/chat` | 发文字，返回 AI 总结的关键词消息 |
| POST | `/api/conversations/:id/generate` | 按勾选的关键词生图（带 `sourceImageId` 即图生图） |
| POST | `/api/conversations/:id/upload` | 上传参考图 |
| GET | `/api/images/:id/file` | 读图片（长缓存） |
| GET | `/api/gallery` | 全站图库，游标分页 |

## 后续可做

- 真正的登录（对接内网 LDAP/SSO 或邮箱验证码）与图片可见性控制
- 生图排队与进度提示（当前为同步等待，Gemini 一般几秒出图）
- 上传时生成缩略图，图库列表省流量
- prompt 模板库、图片/会话删除
