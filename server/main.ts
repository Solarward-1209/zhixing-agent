import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handleAgentRequest, handleHealthRequest } from "./api";

/**
 * 独立生产服务器：静态托管 dist/ 构建产物 + 挂载 /api 路由。
 * 用法：npm run build && npm run server（默认端口 8787，PORT 环境变量可改）
 */

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // API 路由
  if (url.startsWith("/api/chat")) {
    handleAgentRequest(req, res);
    return;
  }
  if (url.startsWith("/api/health")) {
    handleHealthRequest(res);
    return;
  }

  // 静态文件（SPA 回退到 index.html）
  const pathname = decodeURIComponent(url.split("?")[0]);
  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`知行 Agent 服务已启动: http://localhost:${PORT}`);
  console.log(`静态目录: ${DIST}`);
});
