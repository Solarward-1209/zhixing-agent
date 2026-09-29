import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/protocol";
import { buildVisionMessages, MAX_IMAGES, runVisionPath, sanitizeImages } from "../server/vision";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

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
  // 注意：本测试依赖当前 .env 未启用 zhipu 提供商（deepseek 无视觉能力），
  // 若改为 AI_PROVIDER=zhipu 且配有 Key，此用例需相应调整。
  it("返回引导话术而不是报错", async () => {
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
});
