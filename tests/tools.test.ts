import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool, mapWeatherCode, toolRegistry, toolSchemas } from "../server/tools";

describe("calculate 工具（递归下降解析器）", () => {
  it.each([
    ["(128*46+372)/4", "1565"],
    ["1+2*3", "7"],
    ["(1+2)*3", "9"],
    ["100/8", "12.5"],
    ["-5+3", "-2"],
    ["10%3", "1"],
  ])("精确计算 %s", async (expr, expected) => {
    const r = await executeTool("calculate", { expression: expr });
    expect(r.display).toBe("card-calc");
    expect(r.data?.value).toBe(expected);
  });

  it("除零返回失败摘要而不是抛出异常", async () => {
    const r = await executeTool("calculate", { expression: "1/0" });
    expect(r.display).toBe("plain");
    expect(r.summary).toContain("除数不能为零");
  });

  it("非法表达式不抛出异常", async () => {
    const r = await executeTool("calculate", { expression: "1+abc" });
    expect(r.display).toBe("plain");
    expect(r.summary).toContain("计算失败");
  });
});

describe("get_current_time 工具", () => {
  it("返回包含日期与星期的摘要", async () => {
    const r = await executeTool("get_current_time", {});
    expect(r.summary).toMatch(/\d{4}年\d{1,2}月\d{1,2}日/);
    expect(r.summary).toMatch(/星期[日一二三四五六]/);
  });
});

describe("get_weather 工具", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("显式 mock 模式返回样例卡片并标注非实时", async () => {
    const r = await executeTool("get_weather", { city: "北京" }, { weatherMode: "mock" });
    expect(r.display).toBe("card-weather");
    expect(r.data?.isMock).toBe(true);
    expect(r.summary).toContain("离线样例数据");
  });

  it("未收录城市在 mock 模式下给出提示", async () => {
    const r = await executeTool("get_weather", { city: "火星" }, { weatherMode: "mock" });
    expect(r.display).toBe("plain");
    expect(r.summary).toContain("离线样例");
  });

  it("real 模式解析真实数据源（注入 fetch，避免联网）", async () => {
    const fakeFetch = (async (url: string) => {
      if (String(url).includes("geocoding")) {
        return new Response(
          JSON.stringify({ results: [{ name: "北京", latitude: 39.9, longitude: 116.4, admin1: "北京市", country: "中国" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          current: { temperature_2m: 20.4, weather_code: 61, relative_humidity_2m: 55 },
          daily: { temperature_2m_max: [25.2], temperature_2m_min: [15.1] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const r = await executeTool("get_weather", { city: "北京" }, { weatherMode: "real", fetchImpl: fakeFetch });
    expect(r.display).toBe("card-weather");
    expect(r.data?.isMock).toBe(false);
    expect(r.data?.weather).toBe("小雨");
    expect(String(r.data?.temp)).toContain("15");
  });

  it("real 模式失败时如实报错，不返回假数据", async () => {
    const failingFetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const r = await executeTool("get_weather", { city: "北京" }, { weatherMode: "real", fetchImpl: failingFetch });
    expect(r.display).toBe("plain");
    expect(r.summary).toContain("天气查询失败");
    expect(r.data?.isMock).toBeUndefined();
  });

  it("WMO 天气代码映射为中文描述", () => {
    expect(mapWeatherCode(0)).toBe("晴");
    expect(mapWeatherCode(61)).toBe("小雨");
    expect(mapWeatherCode(95)).toContain("雷");
    expect(mapWeatherCode(12345)).toBe("未知天气");
  });
});

describe("understand_image 工具（多模态接入主循环）", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("未附带图片时给出说明", async () => {
    const r = await executeTool("understand_image", { question: "图里有什么" });
    expect(r.summary).toContain("没有附带图片");
  });

  it("未配置视觉模型时给出可执行的引导", async () => {
    vi.stubEnv("VISION_API_KEY", "");
    vi.stubEnv("AI_PROVIDER", "deepseek");
    const r = await executeTool("understand_image", { question: "图里有什么" }, { images: ["data:image/png;base64,xx"] });
    expect(r.summary).toContain("尚未配置视觉模型");
  });
});

describe("工具注册表（MCP 风格契约）", () => {
  it("每个工具都有合法的 JSON Schema 描述", () => {
    expect(toolSchemas().length).toBeGreaterThanOrEqual(4);
    for (const s of toolSchemas()) {
      expect(s.function.name).toBeTruthy();
      expect(s.function.description.length).toBeGreaterThan(5);
      expect(s.function.parameters.type).toBe("object");
    }
  });

  it("调用未注册工具返回错误摘要", async () => {
    const r = await executeTool("not_exist", {});
    expect(r.summary).toContain("未知工具");
  });

  it("工具名不重复", () => {
    const names = toolRegistry.map((t) => t.schema.function.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
