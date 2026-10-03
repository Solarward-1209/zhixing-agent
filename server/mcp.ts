import type { ToolSchema } from "./llm";
import { fetchWithRetry } from "./llm";

/**
 * 标准 MCP（Model Context Protocol）客户端。
 *
 * 实现的是 MCP 的 Streamable HTTP 传输 + JSON-RPC 2.0 方法子集：
 *   initialize → notifications/initialized → tools/list → tools/call
 * 通过环境变量声明一个或多个 MCP Server，工具会被**动态发现**并注册进 Agent 工具表，
 * 与内置工具（计算 / 时间 / 天气 / 图片理解）走同一套 Function Calling 契约。
 *
 * 配置方式（二选一）：
 *   MCP_SERVERS='[{"name":"demo","url":"https://host/mcp","headers":{"Authorization":"Bearer ..."}}]'
 *   MCP_SERVER_URL=https://host/mcp   （单个 Server 的简写）
 *
 * 设计原则：MCP 不可用（未配置 / 网络失败 / 协议不兼容）时**静默降级**，
 * 绝不阻塞主问答流程；工具清单带 TTL 缓存，避免每次请求都做一次握手。
 */

export interface McpServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolRef {
  server: string;
  tool: McpToolDef;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

const TOOL_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

interface ServerState {
  sessionId?: string;
  initializedAt: number;
  tools?: McpToolDef[];
  toolsFetchedAt: number;
}

const states = new Map<string, ServerState>();

/** 解析环境变量得到 MCP Server 列表；未配置返回空数组 */
export function getMcpServers(): McpServerConfig[] {
  const out: McpServerConfig[] = [];
  const raw = process.env.MCP_SERVERS;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const obj = item as { name?: unknown; url?: unknown; headers?: unknown };
          if (typeof obj?.url === "string" && obj.url) {
            out.push({
              name: typeof obj.name === "string" && obj.name ? obj.name : new URL(obj.url).host,
              url: obj.url,
              headers: (obj.headers as Record<string, string> | undefined) ?? undefined,
            });
          }
        }
      }
    } catch {
      // 配置格式非法：当作未配置处理
    }
  }
  const single = process.env.MCP_SERVER_URL;
  if (single && single.trim()) {
    const name = process.env.MCP_SERVER_NAME ?? safeHost(single);
    if (!out.some((s) => s.url === single)) out.push({ name, url: single });
  }
  return out;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "mcp";
  }
}

/** 把 MCP 工具名转换为符合 OpenAI Function Calling 命名规范的名称 */
export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `mcp__${clean(server)}__${clean(tool)}`.slice(0, 64);
}

/** 从注册名反解出 (server, tool)；非法返回 null */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice(5);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

function getState(server: McpServerConfig): ServerState {
  const existing = states.get(server.url);
  if (existing) return existing;
  const created: ServerState = { initializedAt: 0, toolsFetchedAt: 0 };
  states.set(server.url, created);
  return created;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** 解析可能是 application/json 也可能是 text/event-stream 的 MCP 响应 */
async function readRpcResponse(res: Response, expectedId: number | null): Promise<JsonRpcResponse | null> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!contentType.includes("text/event-stream")) {
    try {
      const parsed = JSON.parse(text) as JsonRpcResponse;
      return parsed;
    } catch {
      // 某些服务端对 notification 返回 202 空体，属正常情况
      return null;
    }
  }
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
        if (expectedId === null || parsed.id === expectedId) return parsed;
      } catch {
        // 跳过无法解析的心跳
      }
    }
  }
  return null;
}

async function rpc(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  options: { signal?: AbortSignal; notification?: boolean; id?: number } = {},
): Promise<JsonRpcResponse | null> {
  const state = getState(server);
  const id = options.notification ? undefined : (options.id ?? ++counter);
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (!options.notification) body.id = id;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.headers ?? {}),
  };
  if (state.sessionId) headers["Mcp-Session-Id"] = state.sessionId;

  const res = await fetchWithRetry(
    server.url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { timeoutMs: DEFAULT_TIMEOUT_MS, maxRetries: 1, signal: options.signal },
  );
  const sessionId = res.headers.get("mcp-session-id");
  if (sessionId) state.sessionId = sessionId;
  if (options.notification) {
    await res.text().catch(() => "");
    return null;
  }
  if (!res.ok) return null;
  return readRpcResponse(res, id ?? null);
}

let counter = 0;

/** 握手：initialize + notifications/initialized */
async function ensureInitialized(server: McpServerConfig, signal?: AbortSignal): Promise<boolean> {
  const state = getState(server);
  if (state.initializedAt > 0 && Date.now() - state.initializedAt < TOOL_CACHE_TTL_MS) return true;
  try {
    const res = await rpc(server, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zhixing-agent", version: "1.0.0" },
    }, { signal });
    if (!res || res.error) return false;
    state.initializedAt = Date.now();
    await rpc(server, "notifications/initialized", {}, { signal, notification: true });
    return true;
  } catch {
    return false;
  }
}

/** 发现某个 Server 的工具（带 TTL 缓存） */
export async function listServerTools(
  server: McpServerConfig,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<McpToolDef[]> {
  const state = getState(server);
  const fresh = state.toolsFetchedAt > 0 && Date.now() - state.toolsFetchedAt < TOOL_CACHE_TTL_MS;
  if (!options.force && fresh && state.tools) return state.tools;

  if (!(await ensureInitialized(server, options.signal))) return state.tools ?? [];
  try {
    const res = await rpc(server, "tools/list", {}, { signal: options.signal });
    const result = res?.result as { tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }> } | undefined;
    const tools: McpToolDef[] = (result?.tools ?? [])
      .filter((t) => typeof t.name === "string" && t.name)
      .map((t) => ({
        name: String(t.name),
        description: typeof t.description === "string" ? t.description : String(t.name),
        inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? undefined,
      }));
    state.tools = tools;
    state.toolsFetchedAt = Date.now();
    return tools;
  } catch {
    return state.tools ?? [];
  }
}

/** 汇总所有已配置 Server 的工具 */
export async function listMcpTools(options: { signal?: AbortSignal } = {}): Promise<McpToolRef[]> {
  const servers = getMcpServers();
  if (servers.length === 0) return [];
  const lists = await Promise.all(
    servers.map(async (server) => {
      const tools = await listServerTools(server, options);
      return tools.map((tool) => ({ server: server.name, tool }));
    }),
  );
  return lists.flat();
}

/** 把 MCP 工具转换为 Agent 可用的 ToolSchema */
export function toToolSchema(ref: McpToolRef): ToolSchema {
  const schema = (ref.tool.inputSchema ?? {}) as {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: typeof value?.type === "string" ? value.type : "string",
      description: typeof value?.description === "string" ? value.description : key,
    };
  }
  return {
    type: "function",
    function: {
      name: mcpToolName(ref.server, ref.tool.name),
      description: `[MCP · ${ref.server}] ${ref.tool.description}`,
      parameters: {
        type: "object",
        properties,
        ...(Array.isArray(schema.required) && schema.required.length > 0 ? { required: schema.required } : {}),
      },
    },
  };
}

/** 调用 MCP 工具，把 content 数组拼接为纯文本 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<McpCallResult> {
  const server = getMcpServers().find((s) => s.name === serverName);
  if (!server) return { text: `未找到 MCP Server：${serverName}`, isError: true };
  if (!(await ensureInitialized(server, options.signal))) {
    return { text: `MCP Server「${serverName}」无法建立会话（网络或协议不兼容）`, isError: true };
  }
  try {
    const res = await rpc(server, "tools/call", { name: toolName, arguments: args }, { signal: options.signal });
    if (!res) return { text: `MCP 工具调用无响应：${toolName}`, isError: true };
    if (res.error) return { text: `MCP 错误：${res.error.message ?? "unknown"}`, isError: true };
    const result = res.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = (result?.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : c.type === "image" ? "[图片内容]" : ""))
      .filter(Boolean)
      .join("\n");
    return { text: text || "（MCP 工具返回空结果）", isError: result?.isError === true };
  } catch (err) {
    return { text: `MCP 工具调用失败：${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
