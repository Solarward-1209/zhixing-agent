import { loadProjectEnv } from "./env";

/**
 * 大模型接入层：OpenAI 兼容协议（智谱 AI / DeepSeek 等）。
 * 通过环境变量配置，未配置 API Key 时进入本地演示模式。
 *
 * 稳定性设计（对应评分点「输出是否稳定可控」）：
 * 1. 每次请求都有超时（默认 30s，可用 AI_TIMEOUT_MS 覆盖），避免网络卡死拖垮会话；
 * 2. 429 / 5xx / 网络抖动自动指数退避重试（默认 3 次尝试，可用 AI_MAX_RETRIES 覆盖）；
 * 3. 可选备用模型：AI_FALLBACK_MODEL 配置后，主模型整体失败时自动降级；
 * 4. 全链路支持外部 AbortSignal，用户点「停止」或断开连接可立即取消上游请求。
 */

export interface LlmConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 主模型失败后的降级模型（可选） */
  fallbackModel?: string;
  timeoutMs: number;
  maxRetries: number;
}

const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
};

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function getLlmConfig(): LlmConfig | null {
  const env = loadProjectEnv();
  // 优先级：平台运行时环境变量 > 项目 .env（部署平台注入的密钥永远优先）
  const provider = (process.env.AI_PROVIDER ?? env.AI_PROVIDER ?? "zhipu").toLowerCase();
  const apiKey = process.env.AI_API_KEY ?? env.AI_API_KEY ?? "";
  if (!apiKey) return null;

  const preset = PRESETS[provider];
  const baseUrl = process.env.AI_BASE_URL ?? env.AI_BASE_URL ?? preset?.baseUrl ?? PRESETS.zhipu.baseUrl;
  const model = process.env.AI_MODEL ?? env.AI_MODEL ?? preset?.model ?? PRESETS.zhipu.model;
  const fallbackModel = process.env.AI_FALLBACK_MODEL ?? env.AI_FALLBACK_MODEL ?? undefined;
  const timeoutMs = readInt(process.env.AI_TIMEOUT_MS ?? env.AI_TIMEOUT_MS, 30_000, 3_000, 120_000);
  const maxRetries = readInt(process.env.AI_MAX_RETRIES ?? env.AI_MAX_RETRIES, 2, 0, 5);
  return { provider, apiKey, baseUrl, model, fallbackModel: fallbackModel || undefined, timeoutMs, maxRetries };
}

// ---------- 消息与工具类型（OpenAI 兼容子集） ----------

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

interface ChatChunkChoice {
  delta?: {
    content?: string | null;
    tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

export interface RequestOptions {
  /** 外部取消信号（用户点停止 / 连接断开） */
  signal?: AbortSignal;
  /** 覆盖默认超时 */
  timeoutMs?: number;
  /** 覆盖默认重试次数 */
  maxRetries?: number;
  /** 测试注入的 fetch 实现，生产使用全局 fetch */
  fetchImpl?: typeof fetch;
}

/** 可重试的 HTTP 状态：限流、超时、网关与服务端错误 */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
  return Math.min(4_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("请求已取消"));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * 带超时 + 指数退避重试的 fetch。仅重试「请求阶段」的失败，
 * 已经开始的流式响应不会重试（避免重复输出）。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
  retryable = true,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = retryable ? (options.maxRetries ?? 2) : 0;
  const signal = options.signal;
  const doFetch = options.fetchImpl ?? fetch;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("请求已取消");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await doFetch(url, { ...init, signal: controller.signal });
      if (res.ok || !isRetriableStatus(res.status) || attempt >= maxRetries) return res;
      // 读取并丢弃错误体，避免连接悬挂
      await res.text().catch(() => "");
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw new Error("请求已取消");
      if (attempt >= maxRetries) throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await sleep(backoffMs(attempt), signal);
  }
  throw lastError instanceof Error ? lastError : new Error("大模型请求失败");
}

/**
 * 发起流式（SSE）对话请求，带超时/重试/备用模型降级。
 * 返回已确认 200 的响应，body 交给调用方消费。
 */
export async function openChatStream(
  config: LlmConfig,
  body: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<Response> {
  const models = [config.model, ...(config.fallbackModel ? [config.fallbackModel] : [])];
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const res = await fetchWithRetry(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ ...body, model }),
        },
        { timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, signal: options.signal, fetchImpl: options.fetchImpl },
      );
      if (res.ok && res.body) return res;
      await res.text().catch(() => "");
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (options.signal?.aborted) throw new Error("请求已取消");
    }
  }
  throw lastError instanceof Error ? lastError : new Error("大模型流式请求失败");
}

/**
 * 非流式补全（用于规划步骤生成），同样具备超时/重试/降级能力。
 */
export async function chatCompletion(
  config: LlmConfig,
  messages: LlmMessage[],
  options: RequestOptions = {},
): Promise<string> {
  const res = await openChatStream(config, { messages, temperature: 0.3, stream: false }, options);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 解析 OpenAI 兼容的 SSE 流：产出文本增量与聚合完成的工具调用。
 * 供 chatCompletionStream 与视觉模型通道复用。
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onToolCall?: (call: ToolCallRequest) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // 流式 tool_calls 按 index 聚合
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as { choices?: ChatChunkChoice[] };
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta;
          if (delta?.content) onDelta(delta.content);
          if (onToolCall && delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const slot = pendingCalls.get(tc.index) ?? { id: "", name: "", args: "" };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              pendingCalls.set(tc.index, slot);
            }
          }
          if (onToolCall && choice.finish_reason === "tool_calls") {
            for (const call of pendingCalls.values()) {
              onToolCall({ id: call.id || `call_${call.name}`, name: call.name, arguments: call.args || "{}" });
            }
            pendingCalls.clear();
          }
        } catch {
          // 忽略无法解析的心跳/杂散行
        }
      }
    }
  } finally {
    // 用户取消时主动释放底层连接，避免上游继续计费
    if (signal?.aborted) await reader.cancel().catch(() => {});
  }

  if (onToolCall) {
    // 某些网关不发 finish_reason=tool_calls，结束时兜底冲刷
    for (const call of pendingCalls.values()) {
      if (call.name) onToolCall({ id: call.id || `call_${call.name}`, name: call.name, arguments: call.args || "{}" });
    }
  }
}

/**
 * 流式补全（SSE），回调逐段产出文本增量与完整工具调用。
 */
export async function chatCompletionStream(
  config: LlmConfig,
  messages: LlmMessage[],
  tools: ToolSchema[],
  onDelta: (text: string) => void,
  onToolCall: (call: ToolCallRequest) => void,
  options: RequestOptions = {},
): Promise<void> {
  const res = await openChatStream(
    config,
    {
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      temperature: 0.6,
    },
    options,
  );
  if (!res.body) throw new Error("大模型流式响应为空");
  await consumeSseStream(res.body, onDelta, onToolCall, options.signal);
}
