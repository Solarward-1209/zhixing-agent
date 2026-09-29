# 部署指南（在线演示 · 加分项）

大赛"在线演示"为可选加分项：需提供**可公网访问的地址**，评审期间保持服务可用；如需登录须提供测试账号（本作品无需登录，此项天然满足）。

> 安全红线：`AI_API_KEY` 等密钥**只通过部署平台的环境变量**注入，绝不写进仓库或镜像。`.dockerignore` 已排除 `.env`。

## 方式一：Render（推荐，免费档可用，全程网页操作）

1. 把 GitHub 仓库 fork/推送到你的账号后，登录 [render.com](https://render.com)，**New → Web Service**，连接该仓库；
2. 配置：
   - **Runtime**：Node
   - **Build Command**：`npm ci && npm run build`
   - **Start Command**：`npm run server`
   - **Health Check Path**：`/api/health`
3. **Environment** 中添加：
   - `AI_PROVIDER=deepseek`
   - `AI_API_KEY=<你的Key>`
   - （可选）`VISION_API_KEY` / `EMBEDDING_API_KEY` 等
4. 部署完成后获得 `https://xxx.onrender.com`，即为可提交的在线演示地址。

> 免费档 15 分钟无访问会休眠，评审前先自己访问一次唤醒，或在平台付费升级常驻。

## 方式二：Railway / Fly.io

流程类似：连接仓库 → Build `npm ci && npm run build` → Start `npm run server` → 注入环境变量 → 拿到公网域名。

## 方式三：Docker（任意有 Docker 的主机 / 云服务器）

```bash
docker build -t zhixing-agent .
docker run -d -p 80:8787 \
  -e AI_PROVIDER=deepseek \
  -e AI_API_KEY=<你的Key> \
  --name zhixing-agent zhixing-agent
```

## 方式四：自己的云服务器（裸机）

```bash
git clone https://github.com/Solarward-1209/zhixing-agent.git
cd zhixing-agent
npm ci && npm run build
AI_PROVIDER=deepseek AI_API_KEY=<你的Key> PORT=80 npm run server
```

建议用 `pm2` 守护：`pm2 start "npm run server" --name zhixing-agent`，并配置 Nginx 反向代理与 HTTPS。

## 为什么不能直接托管到 Vercel 静态档？

本作品的 `/api/chat`（SSE 流式）是常驻 Node 服务，不是 Serverless 函数。当前架构面向 Render/Railway/Docker 这类"长驻进程"平台零改动部署；如需 Vercel，需将 `server/` 改写为 Route Handler（Next.js 迁移路线，见 README 路线图）。

## 部署后自检清单

- [ ] 访问 `/api/health` 返回 `{"mode":"ai",...}`（而非 demo）
- [ ] 首页可打开，发送一个问题能收到流式回答
- [ ] 提问"报名截止时间"回答带引用来源
- [ ] 平台日志无密钥打印
- [ ] 评审前一天再访问一次确认服务存活
