#!/usr/bin/env bash
# 内网部署一键脚本：装依赖 → 交互式生成 .env → 构建前端
# 之后用 npm start 启动服务（默认 8787 端口），内网用户访问 http://<服务器IP>:8787
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }

command -v node >/dev/null || { echo "请先安装 Node.js 20+（https://nodejs.org）"; exit 1; }

step "安装依赖"
npm install

step "生成 .env 配置（仅存本机，不会提交 git）"
if [ -f .env ]; then
    echo "已存在 .env，跳过（如需修改请直接编辑该文件）"
else
    read -r -p "Aiberm 令牌（sk- 开头）: " AI_KEY
    case "$AI_KEY" in sk-*) : ;; *) echo "看起来不是 sk- 开头的令牌，退出"; exit 1 ;; esac
    echo "接下来是 Cloudflare R2 的 S3 凭据（在 R2 控制台创建 API 令牌时显示）；直接回车跳过则图片存本地磁盘"
    read -r -p "R2 端点（https://<account_id>.r2.cloudflarestorage.com）: " R2_EP
    R2_AK="" R2_SK="" R2_BUCKET=""
    if [ -n "$R2_EP" ]; then
        read -r -p "Access Key ID: " R2_AK
        read -r -p "Secret Access Key: " R2_SK
        read -r -p "桶名 [genphotos]: " R2_BUCKET
        R2_BUCKET=${R2_BUCKET:-genphotos}
    fi
    {
        echo "PORT=8787"
        echo "DB_PATH=data/app.db"
        echo "AI_BASE_URL=https://aiberm.com"
        echo "AI_API_KEY=$AI_KEY"
        echo "TEXT_MODEL=google/gemini-2.5-flash"
        echo "IMAGE_MODEL=gemini-2.5-flash-image"
        if [ -n "$R2_EP" ]; then
            echo "R2_ENDPOINT=$R2_EP"
            echo "R2_ACCESS_KEY_ID=$R2_AK"
            echo "R2_SECRET_ACCESS_KEY=$R2_SK"
            echo "R2_BUCKET=$R2_BUCKET"
        fi
    } > .env
    echo "已写入 .env"
fi

step "构建前端"
npm run build

step "完成！启动服务："
echo "  npm start                        # 前台运行"
echo "  nohup npm start >app.log 2>&1 &  # 简单后台运行（正式建议用 pm2 或 systemd）"
