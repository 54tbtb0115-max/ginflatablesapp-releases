#!/usr/bin/env bash
# 一键配置 / 部署脚本
#   本地开发：  ./setup.sh          （装依赖、配密钥、建本地库，然后 npm run dev 即可）
#   部署上线：  ./setup.sh deploy   （在上面基础上：建 D1/R2、建表、传密钥、部署到 Cloudflare）
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }

command -v node >/dev/null || { echo "请先安装 Node.js（https://nodejs.org）"; exit 1; }

step "安装依赖"
npm install

step "配置 AI 密钥（.dev.vars，仅存本机，不会提交 git）"
if [ -f .dev.vars ] && grep -q '^AI_API_KEY=sk-' .dev.vars; then
    echo "已存在 .dev.vars，跳过（如需更换密钥请直接编辑该文件）"
else
    if [ -n "${AI_API_KEY:-}" ]; then
        KEY="$AI_API_KEY"
    else
        read -r -p "请粘贴 Aiberm 令牌（sk- 开头）: " KEY
    fi
    case "$KEY" in
        sk-*) printf 'AI_API_KEY=%s\n' "$KEY" > .dev.vars; echo "已写入 .dev.vars" ;;
        *) echo "看起来不是 sk- 开头的令牌，退出"; exit 1 ;;
    esac
fi

step "初始化本地数据库"
npm run db:migrate:local

if [ "${1:-}" != "deploy" ]; then
    step "本地配置完成"
    echo "运行 npm run dev 后打开 http://localhost:5173"
    echo "要部署上线时运行：./setup.sh deploy"
    exit 0
fi

# ---------- 以下为部署到 Cloudflare ----------

step "检查 Cloudflare 登录状态"
if ! npx wrangler whoami >/dev/null 2>&1; then
    echo "尚未登录，即将打开浏览器授权 Cloudflare 账号…"
    npx wrangler login
fi

step "创建 D1 数据库（已存在则复用）"
if grep -q 'REPLACE_WITH_YOUR_D1_DATABASE_ID' wrangler.jsonc; then
    UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    DB_ID=$(npx wrangler d1 create ai-image-studio 2>&1 | grep -oE "$UUID_RE" | head -1 || true)
    if [ -z "$DB_ID" ]; then
        DB_ID=$(npx wrangler d1 list --json 2>/dev/null | node -e '
            let s = "";
            process.stdin.on("data", (d) => (s += d)).on("end", () => {
                const db = JSON.parse(s).find((d) => d.name === "ai-image-studio");
                if (db) process.stdout.write(db.uuid);
            });
        ')
    fi
    [ -n "$DB_ID" ] || { echo "无法获取 D1 database_id，请手动执行 npx wrangler d1 create ai-image-studio"; exit 1; }
    node -e '
        const fs = require("fs");
        const f = "wrangler.jsonc";
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("REPLACE_WITH_YOUR_D1_DATABASE_ID", process.argv[1]));
    ' "$DB_ID"
    echo "database_id 已写入 wrangler.jsonc：$DB_ID"
else
    echo "wrangler.jsonc 已配置 database_id，跳过"
fi

step "创建 R2 存储桶（已存在则复用）"
npx wrangler r2 bucket create ai-image-studio-images 2>&1 | tail -1 || true

step "初始化线上数据库表"
npm run db:migrate

step "上传 AI 密钥到 Cloudflare（secret）"
grep '^AI_API_KEY=' .dev.vars | cut -d= -f2- | npx wrangler secret put AI_API_KEY

step "构建并部署"
npm run deploy

step "完成！上面输出的 workers.dev 地址就是你的网站"
