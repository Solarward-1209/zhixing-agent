import type { AgentEvent } from "../shared/protocol";
import { loadProjectEnv } from "./env";
import { consumeSseStream, getLlmConfig } from "./llm";

/**
 * 多模态（图片理解）通道：OpenAI 兼容的视觉模型（默认智谱 GLM-4V-Flash）。
 * 通过 VISION_API_KEY / VISION_MODEL / VISION_BASE_URL 配置；
 * 未配置时不报错，返回引导话术（保证功能可发现、可解释）。
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
  const provider = (env.AI_PROVIDER ?? process.env.AI_PROVIDER ?? "").toLowerCase();
  const apiKey =
    env.VISION_API_KEY ??
    process.env.VISION_API_KEY ??
    (provider === "zhipu" ? env.AI_API_KEY ?? process.env.AI_API_KEY ?? "" : "");
  if (!apiKey) return null;
  const model = env.VISION_MODEL ?? process.env.VISION_MODEL ?? "glm-4v-flash";
  const baseUrl = env.VISION_BASE_URL ?? process.env.VISION_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
  return { apiKey, model, baseUrl };
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
3. 图片涉及文字时如实转录关键内容。`;

export async function runVisionPath(userText: string, images: string[], emit: Emit): Promise<void> {
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
    await sleep(400);
    emit({ type: "step_update", index: 0, status: "done" });
    emit({ type: "step_update", index: 1, status: "running" });
    emit({ type: "status", stage: "answering" });

    const messages = buildVisionMessages(VISION_SYSTEM_PROMPT, userText, images);
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, stream: true, temperature: 0.4 }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`视觉模型请求失败：HTTP ${res.status}`);
    }
    await consumeSseStream(res.body, (text) => emit({ type: "token", content: text }));

    emit({ type: "step_update", index: 1, status: "done" });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : "图片理解失败" });
    emit({ type: "token", content: "\n\n抱歉，图片理解暂时失败了，请稍后重试或换个更小的图片。" });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  }
}
