import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentEvent, ChatRequestBody, HealthInfo } from "../shared/protocol";
import { runAgent } from "./agent";
import { getLlmConfig } from "./llm";

/**
 * HTTP 层：POST /api/chat（SSE 事件流）与 GET /api/health。
 * 挂载在 Vite 开发服务器中间件上，生产部署可平移到独立 Node 服务。
 */

export function handleHealthRequest(res: ServerResponse): void {
  const config = getLlmConfig();
  const info: HealthInfo = config
    ? { mode: "ai", provider: config.provider, model: config.model }
    : { mode: "demo" };
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(info));
}

export function handleAgentRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    let body: ChatRequestBody;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as ChatRequestBody;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const message = (body.message ?? "").trim();
    if (!message) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "message is required" }));
      return;
    }
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

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

    // 客户端提前断开：响应流的 close（注意不能监听 req 的 close，
    // Node ≥16 请求体读完即触发 req 'close'，会误判为断连）
    res.on("close", () => {
      if (!res.writableEnded) closed = true;
    });

    runAgent(message, history, emit)
      .catch((err) => {
        emit({ type: "error", message: err instanceof Error ? err.message : "服务器内部错误" });
        emit({ type: "done" });
      })
      .finally(() => {
        if (!closed) res.end();
      });
  });
}
