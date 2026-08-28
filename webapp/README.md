# AI 画室（聊天式文生图 / 图生图）

一个跑在 Cloudflare 上的 AI 生图网站：

1. **文生图**：用户发中文描述 → 关键词 AI 总结出「场景 / 主体 / 风格 / 光线 / 构图」关键词 → 用户勾选（可补充说明）→ 提示词 AI 润色成英文 prompt → 生图 AI 出图
2. **图生图**：上传参考图，或点任意一张历史图的「以此图再创作」，再走同样的关键词流程
3. **连续聊天**：同一会话内的历史消息会作为上下文传给 AI，可以说「把刚才那张改成夜晚的」
4. **图片全部落盘**：图片实体存 **R2**，元数据（prompt、关键词、所属会话）存 **D1**，每张图都是聊天里的一条消息
5. **图库**：`/gallery` 汇集所有用户生成的所有图片，瀑布流 + 游标分页，可查看 prompt、下载、再创作

界面样式参考 Themesbrand 的 Chatvia Tailwind 模板（violet 主色、Public Sans 字体、左侧图标栏 + 会话列表 + 聊天区布局，支持暗色模式），用 React 重新实现。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + Tailwind CSS + react-router |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1（表结构见 `schema.sql`） |
| 图片存储 | Cloudflare R2（`images/{userId}/{conversationId}/{imageId}.png`） |
| AI | 通过 API 中转平台（Aiberm 等）调 **Gemini**：`gemini-2.5-flash` 做关键词总结与 prompt 润色（OpenAI 兼容接口），`gemini-2.5-flash-image` 做文生图和图生图（Gemini 原生 `generateContent` 接口，图生图即把参考图作为 `inline_data` 传入）。平台地址与模型名都在 `wrangler.jsonc` 的 `vars` 里，令牌通过 secret 配置 |

用户识别目前是最简方案：首次访问发一个一年期 `uid` cookie 自动建用户。后续要做真正的登录，只需替换 `worker/index.ts` 里的用户中间件。

## 目录结构

```
webapp/
├── worker/          # Workers 后端（Hono 路由 + AI 调用）
│   ├── index.ts     # API：会话 / 消息 / 生图 / 上传 / 图库 / 图片文件
│   └── ai.ts        # Workers AI 封装：关键词总结、prompt 润色、t2i、i2i
├── src/             # React 前端
│   ├── pages/       # ChatPage（聊天生图）、GalleryPage（图库）
│   └── components/  # Sidebar 等
├── shared/types.ts  # 前后端共用类型
├── schema.sql       # D1 建表语句
└── wrangler.jsonc   # Workers / D1 / R2 / AI 绑定配置
```

## 快速开始（一键脚本）

```bash
cd webapp
./setup.sh           # 本地开发：装依赖 + 配密钥 + 建本地库，然后 npm run dev
./setup.sh deploy    # 部署上线：额外自动建 D1/R2、建表、传密钥、部署到 Cloudflare
```

脚本会提示粘贴一次 Aiberm 令牌（sk-...），并在部署时自动把 D1 的 database_id 回填进 wrangler.jsonc。

## 本地开发（手动步骤）

```bash
cd webapp
npm install
cp .dev.vars.example .dev.vars   # 填入你的中转平台令牌（sk-...）
npm run db:migrate:local         # 初始化本地 D1
npm run dev                      # vite dev（@cloudflare/vite-plugin 会同时跑 Worker，本地模拟 D1/R2）
```

`.dev.vars` 已被 .gitignore 忽略，**令牌不要提交到仓库**；万一泄露，去中转平台的「令牌管理」删除重建即可。

## 部署

```bash
wrangler d1 create ai-image-studio          # 把返回的 database_id 填入 wrangler.jsonc
wrangler r2 bucket create ai-image-studio-images
npm run db:migrate                          # 线上建表
wrangler secret put AI_API_KEY              # 粘贴中转平台的令牌（sk-...）
npm run deploy                              # 构建并部署
```

模型名以中转平台「模型」页列出的为准；要换模型（例如更强的图像模型）只需改 `wrangler.jsonc` 里的 `IMAGE_MODEL` / `TEXT_MODEL` 重新部署。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/conversations` | 会话列表 / 新建会话 |
| GET | `/api/conversations/:id/messages` | 会话消息（含图片消息） |
| POST | `/api/conversations/:id/chat` | 发文字，返回 AI 总结的关键词消息 |
| POST | `/api/conversations/:id/generate` | 按勾选的关键词生图（带 `sourceImageId` 即图生图） |
| POST | `/api/conversations/:id/upload` | 上传参考图 |
| GET | `/api/images/:id/file` | 从 R2 读图片（长缓存） |
| GET | `/api/gallery` | 全站图库，游标分页 |

## 后续可做

- 真正的登录（邮箱验证码 / OAuth）与图片可见性控制
- 生图改为队列 + 轮询（Cloudflare Queues），支持更慢的外部模型
- 上传时生成缩略图（Cloudflare Image Resizing），图库列表省流量
- prompt 模板库、图片删除、会话删除
