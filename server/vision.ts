import type { AgentEvent } from "../shared/protocol";
import { loadProjectEnv } from "./env";
import { consumeSseStream, getLlmConfig, openChatStream } from "./llm";

/**
 * 多模态（图片理解）通道：OpenAI 兼容的视觉模型（默认智谱 GLM-4V-Flash）。
 * 通过 VISION_API_KEY / VISION_MODEL / VISION_BASE_URL 配置。
 *
 * 设计要点：
 * 1. 区分「未配置」与「调用失败」两种状态，给用户可执行的排查建议（而不是笼统的"失败了"）；
 * 2. 对外提供 describeImage()，让图片理解可以作为工具被 Agent 主循环自主调用（多模态融合）；
 * 3. 请求带超时/重试/取消信号，与文本链路一致。
 */

export interface VisionConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** 图片数量与体积上限（data URL 长度近似校验） */
export const MAX_IMAGES = 2;
export const MAX_IMAGE_DATA_URL_LENGTH = 7_000_000; // ≈ 5MB 二进制

export function getVisionConfig(): VisionConfig | null {
  const env = loadProjectEnv();
  const provider = (process.env.AI_PROVIDER ?? env.AI_PROVIDER ?? "").toLowerCase();
  const apiKey =
    process.env.VISION_API_KEY ??
    env.VISION_API_KEY ??
    (provider === "zhipu" ? (process.env.AI_API_KEY ?? env.AI_API_KEY ?? "") : "");
  if (!apiKey) return null;
  const model = process.env.VISION_MODEL ?? env.VISION_MODEL ?? "glm-4v-flash";
  const baseUrl = process.env.VISION_BASE_URL ?? env.VISION_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
  return { apiKey, model, baseUrl };
}

export function hasVisionConfig(): boolean {
  return getVisionConfig() !== null;
}

/** 校验客户端上传的图片（格式与数量），返回合法 data URL 列表 */
export function sanitizeImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter(
      (u): u is string =>
        typeof u === "string" &&
        u.startsWith("data:image/") &&
        u.length <= MAX_IMAGE_DATA_URL_LENGTH,
    )
    .slice(0, MAX_IMAGES);
}

/** 构建视觉模型消息（OpenAI 兼容 content 数组格式） */
export function buildVisionMessages(
  systemPrompt: string,
  question: string,
  images: string[],
): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  const content: Array<Record<string, unknown>> = images.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));
  content.push({ type: "text", text: question || "请描述这张图片的内容" });
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ];
}

type Emit = (event: AgentEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VISION_SYSTEM_PROMPT = `你是「知行 Agent」的图片理解模块。请用中文、结构化地回答用户关于图片的问题：
1. 先简要说明图片里有什么，再针对用户的问题作答。
2. 描述准确克制，看不清或不确定的内容如实说明，不要编造细节。
3. 图片涉及文字时如实转录关键内容，表格数据用 Markdown 表格还原。
4. 只输出对图片的描述与结论，不要输出与图片无关的寒暄。`;

export interface DescribeOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

/**
 * 调用视觉模型，返回完整的图片理解文本。
 * 供 understand_image 工具与 runVisionPath 复用。
 */
export async function describeImage(question: string, images: string[], options: DescribeOptions = {}): Promise<string> {
  const config = getVisionConfig();
  if (!config) throw new Error("尚未配置视觉模型（VISION_API_KEY）");
  const messages = buildVisionMessages(VISION_SYSTEM_PROMPT, question, images);
  const res = await openChatStream(
    {
      provider: "vision",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: 45_000,
      maxRetries: 1,
    },
    { messages, stream: true, temperature: 0.4 },
    { signal: options.signal, timeoutMs: 45_000, maxRetries: 1 },
  );
  if (!res.body) throw new Error("视觉模型响应为空");

  let full = "";
  await consumeSseStream(
    res.body,
    (text) => {
      full += text;
      options.onDelta?.(text);
    },
    undefined,
    options.signal,
  );
  if (!full.trim()) throw new Error("视觉模型返回了空内容");
  return full;
}

/**
 * 独立的图片问答通道（保留给"仅图片、无正文"的快捷路径与单元测试）。
 * 未配置时返回引导话术；调用失败时返回可执行的排查建议。
 */
export async function runVisionPath(
  userText: string,
  images: string[],
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  emit({ type: "status", stage: "understanding" });
  const config = getVisionConfig();

  if (!config) {
    await sleep(200);
    emit({
      type: "token",
      content:
        "📷 图片已收到，但尚未配置视觉模型，暂时无法识图。\n\n" +
        "启用方法（智谱 GLM-4V-Flash 有免费额度）：在 `.env` 中加入以下配置并重启：\n\n" +
        "```bash\nVISION_API_KEY=你的智谱APIKey\nVISION_MODEL=glm-4v-flash\n```\n\n" +
        "配置后即可发送图片并针对图片提问（识别内容、转录文字、答疑等）。\n" +
        "也可以先把图片里的文字打出来直接问我。",
    });
    emit({ type: "done", meta: { mode: getLlmConfig() ? "ai" : "demo" } });
    return;
  }

  try {
    emit({ type: "plan", steps: ["解析图片内容", "多模态理解与回答"] });
    emit({ type: "step_update", index: 0, status: "running", note: `已接收 ${images.length} 张图片` });
    emit({ type: "status", stage: "answering" });
    emit({ type: "step_update", index: 0, status: "done" });
    emit({ type: "step_update", index: 1, status: "running" });

    await describeImage(userText, images, {
      signal,
      onDelta: (text) => emit({ type: "token", content: text }),
    });

    emit({ type: "step_update", index: 1, status: "done" });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "图片理解失败";
    emit({ type: "error", message });
    emit({
      type: "token",
      content:
        "\n\n抱歉，图片理解暂时失败了。可能的原因与建议：\n" +
        "1. `VISION_API_KEY` 失效或额度用尽——请到智谱开放平台确认；\n" +
        "2. 图片过大或格式特殊——可压缩到 5MB 以内、或截取关键区域后重试；\n" +
        "3. 网络不稳定——稍后重试，或直接把图片里的文字打出来问我。",
    });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  }
}
