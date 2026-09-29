import { loadProjectEnv } from "./env";

/**
 * 大模型接入层：OpenAI 兼容协议（智谱 AI / DeepSeek 等）。
 * 通过环境变量配置，未配置 API Key 时进入本地演示模式。
 */

export interface LlmConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
};

export function getLlmConfig(): LlmConfig | null {
  const env = loadProjectEnv();
  const provider = (env.AI_PROVIDER ?? process.env.AI_PROVIDER ?? "zhipu").toLowerCase();
  const apiKey = env.AI_API_KEY ?? process.env.AI_API_KEY ?? "";
  if (!apiKey) return null;

  const preset = PRESETS[provider];
  const baseUrl = env.AI_BASE_URL ?? process.env.AI_BASE_URL ?? preset?.baseUrl ?? PRESETS.zhipu.baseUrl;
  const model = env.AI_MODEL ?? process.env.AI_MODEL ?? preset?.model ?? PRESETS.zhipu.model;
  return { provider, apiKey, baseUrl, model };
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

/**
 * 非流式补全（用于规划步骤生成）。
 */
export async function chatCompletion(config: LlmConfig, messages: LlmMessage[]): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.3 }),
  });
  if (!res.ok) {
    throw new Error(`LLM 请求失败：HTTP ${res.status}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
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
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      temperature: 0.6,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM 流式请求失败：HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // 流式 tool_calls 按 index 聚合
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

  for (;;) {
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
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const slot = pendingCalls.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            pendingCalls.set(tc.index, slot);
          }
        }
        if (choice.finish_reason === "tool_calls") {
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
  // 某些网关不发 finish_reason=tool_calls，结束时兜底冲刷
  for (const call of pendingCalls.values()) {
    if (call.name) onToolCall({ id: call.id || `call_${call.name}`, name: call.name, arguments: call.args || "{}" });
  }
}
