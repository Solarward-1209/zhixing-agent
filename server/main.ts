import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { handleAgentRequest, handleHealthRequest } from "./api";

/**
 * 独立生产服务器：静态托管 dist/ 构建产物 + 挂载 /api 路由。
 * 用法：npm run build && npm run server（默认端口 8787，PORT 环境变量可改）
 *
 * 本轮优化：对文本类静态资源启用 gzip 传输，减少首屏加载体积。
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
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".txt", ".webmanifest"]);

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
  const file = path.normalize(path.join(DIST, pathname));
  const relative = path.relative(DIST, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(DIST, "index.html");
  }
  const ext = path.extname(target).toLowerCase();
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
    Vary: "Accept-Encoding",
  };

  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (acceptsGzip && COMPRESSIBLE.has(ext)) {
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    fs.createReadStream(target).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`知行 Agent 服务已启动: http://localhost:${PORT}`);
  console.log(`静态目录: ${DIST}`);
});
