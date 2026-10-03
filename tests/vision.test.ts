import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../shared/protocol";
import { buildVisionMessages, describeImage, MAX_IMAGES, runVisionPath, sanitizeImages } from "../server/vision";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** 让"未配置视觉模型"的用例不再依赖开发者本机 .env */
function stubNoVision(): void {
  vi.stubEnv("VISION_API_KEY", "");
  vi.stubEnv("AI_PROVIDER", "deepseek");
}

describe("图片输入校验", () => {
  it("仅接受 data:image/ 开头且不超过体积上限的图片", () => {
    const ok = sanitizeImages([PNG, "https://evil.example/x.png", "hello", 123]);
    expect(ok).toEqual([PNG]);
  });

  it("超过数量上限时截断", () => {
    const many = Array.from({ length: 5 }, () => PNG);
    expect(sanitizeImages(many).length).toBe(MAX_IMAGES);
  });

  it("非数组输入返回空", () => {
    expect(sanitizeImages(undefined)).toEqual([]);
    expect(sanitizeImages("data:image/png;base64,xx")).toEqual([]);
  });
});

describe("视觉消息构建（OpenAI 兼容格式）", () => {
  it("生成 image_url + text 的 content 数组", () => {
    const msgs = buildVisionMessages("sys", "图里有什么？", [PNG]);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("system");
    expect(Array.isArray(msgs[1].content)).toBe(true);
    const content = msgs[1].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("image_url");
    expect(content[content.length - 1].type).toBe("text");
  });

  it("空问题时使用默认描述指令", () => {
    const msgs = buildVisionMessages("sys", "", [PNG]);
    const content = msgs[1].content as Array<Record<string, unknown>>;
    expect(content[content.length - 1].text as string).toContain("描述这张图片");
  });
});

describe("未配置视觉模型时的优雅降级", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("返回引导话术而不是报错", async () => {
    stubNoVision();
    const events: AgentEvent[] = [];
    await runVisionPath("图里有什么？", [PNG], (e) => events.push(e));
    const text = events
      .filter((e) => e.type === "token")
      .map((e) => (e.type === "token" ? e.content : ""))
      .join("");
    expect(text).toContain("尚未配置视觉模型");
    expect(text).toContain("VISION_API_KEY");
    const types = events.map((e) => e.type);
    expect(types).not.toContain("error");
    expect(types).toContain("done");
  });

  it("未配置时 describeImage 直接抛错，便于上层转成引导话术", async () => {
    stubNoVision();
    await expect(describeImage("图里有什么？", [PNG])).rejects.toThrow("尚未配置");
  });
});

describe("已配置但调用失败时的可执行提示", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("给出 error 事件与排查建议，而不是笼统的失败", async () => {
    vi.stubEnv("VISION_API_KEY", "test-key");
    vi.stubEnv("VISION_MODEL", "glm-4v-flash");
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const events: AgentEvent[] = [];
    await runVisionPath("图里有什么？", [PNG], (e) => events.push(e));
    const types = events.map((e) => e.type);
    expect(types).toContain("error");
    const text = events
      .filter((e) => e.type === "token")
      .map((e) => (e.type === "token" ? e.content : ""))
      .join("");
    expect(text).toContain("VISION_API_KEY");
    expect(text).toContain("重试");
  });
});
