import { describe, expect, it } from "vitest";
import { executeTool, toolRegistry, toolSchemas } from "../server/tools";

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

describe("get_weather 工具（模拟数据）", () => {
  it("命中城市返回卡片并标注模拟数据", async () => {
    const r = await executeTool("get_weather", { city: "北京" });
    expect(r.display).toBe("card-weather");
    expect(r.data?.isMock).toBe(true);
  });

  it("未收录城市返回提示", async () => {
    const r = await executeTool("get_weather", { city: "火星" });
    expect(r.display).toBe("plain");
    expect(r.summary).toContain("演示数据");
  });
});

describe("工具注册表（MCP 风格契约）", () => {
  it("每个工具都有合法的 JSON Schema 描述", () => {
    expect(toolSchemas().length).toBeGreaterThanOrEqual(3);
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
