import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentEvent, ChatRequestBody, HealthInfo } from "../shared/protocol";
import { runAgent } from "./agent";
import { getLlmConfig } from "./llm";
import { retrievalMode, knowledgeSize, domains } from "./rag";
import { sanitizeImages, hasVisionConfig } from "./vision";

/**
 * HTTP 层：POST /api/chat（SSE 事件流）与 GET /api/health。
 * 挂载在 Vite 开发服务器中间件上，生产部署可平移到独立 Node 服务。
 *
 * 本轮加固：
 * 1. 请求体大小上限（默认 8MB，可通过 MAX_BODY_BYTES 调整），超限 413，避免内存被大 body 打爆；
 * 2. 轻量令牌桶限流（默认 60s / 30 次每 IP，可用 RATE_LIMIT_MAX 调整）；
 * 3. history / message 严格校验与截断，防止畸形数据进入模型；
 * 4. 连接断开时把 AbortSignal 透传给 Agent，立即取消上游大模型请求（省 token）。
 */

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 8 * 1024 * 1024);
const MAX_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_ENTRIES = 8;
const MAX_HISTORY_ITEM_CHARS = 8_000;

const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX ?? 30);
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}

/** 滑动窗口限流：返回需等待的毫秒数，0 表示放行 */
function rateLimitDelay(key: string): number {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return 0;
  }
  if (bucket.count >= RATE_MAX) return bucket.resetAt - now;
  bucket.count += 1;
  return 0;
}

// 定期清理过期桶，避免长期运行内存增长
if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, RATE_WINDOW_MS);
  // 不阻塞进程退出
  timer.unref();
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function handleHealthRequest(res: ServerResponse): void {
  const config = getLlmConfig();
  const info: HealthInfo = config
    ? {
        mode: "ai",
        provider: config.provider,
        model: config.model,
        retrieval: retrievalMode(),
        vision: hasVisionConfig(),
        knowledgeChunks: knowledgeSize(),
        domains: domains(),
      }
    : {
        mode: "demo",
        retrieval: retrievalMode(),
        vision: hasVisionConfig(),
        knowledgeChunks: knowledgeSize(),
        domains: domains(),
      };
  sendJson(res, 200, info);
}

/** 校验并裁剪客户端历史，防止畸形结构进入模型 */
function normalizeHistory(raw: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { role: "user" | "assistant"; content: string } =>
        typeof item === "object" &&
        item !== null &&
        ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") &&
        typeof (item as { content?: unknown }).content === "string",
    )
    .map((item) => ({ role: item.role, content: item.content.slice(0, MAX_HISTORY_ITEM_CHARS) }))
    .filter((item) => item.content.trim().length > 0)
    .slice(-MAX_HISTORY_ENTRIES);
}

export function handleAgentRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method Not Allowed" });
    return;
  }

  const wait = rateLimitDelay(clientKey(req));
  if (wait > 0) {
    res.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
    sendJson(res, 429, { error: "请求过于频繁，请稍后再试", retryAfterMs: wait });
    return;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;
  const controller = new AbortController();

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: `请求体过大，上限 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB` });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (aborted) return;

    let body: ChatRequestBody;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as ChatRequestBody;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length > MAX_MESSAGE_CHARS) {
      sendJson(res, 413, { error: `消息过长，请控制在 ${MAX_MESSAGE_CHARS} 字以内` });
      return;
    }
    const images = sanitizeImages(body.images);
    // 纯图片发送允许 message 为空（Agent 会用默认指令描述图片）
    if (!message && images.length === 0) {
      sendJson(res, 400, { error: "message is required" });
      return;
    }
    const history = normalizeHistory(body.history);
    // 知识域白名单校验：只接受服务端已知的域 id，防止把任意字符串带进检索层
    const knownDomains = new Set(["all", ...domains().map((d) => d.id)]);
    const requested = typeof body.domain === "string" ? body.domain.trim() : "";
    const domain = knownDomains.has(requested) ? requested : "all";

    // SSE 响应头
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const emit = (event: AgentEvent): void => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // 客户端提前断开：取消上游大模型请求（注意不能监听 req 的 close，
    // Node ≥16 请求体读完即触发 req 'close'，会误判为断连）
    res.on("close", () => {
      if (!res.writableEnded) {
        closed = true;
        controller.abort();
      }
    });

    runAgent(message, history, images, emit, { signal: controller.signal, domain })
      .catch((err) => {
        emit({ type: "error", message: err instanceof Error ? err.message : "服务器内部错误" });
        emit({ type: "done" });
      })
      .finally(() => {
        if (!closed) res.end();
      });
  });

  req.on("error", () => {
    controller.abort();
  });
}
