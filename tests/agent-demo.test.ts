import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/protocol";
import { runDemoAgent } from "../server/demo";

/**
 * 演示模式端到端流水线测试（不依赖网络与大模型 Key）。
 *
 * 为什么必须测：评审很可能在没有 API Key 的环境里直接 clone 复现，
 * 演示模式就是那条"零配置可跑"的路径。这里断言的是**完整事件序列**，
 * 而不是只断言返回字符串——因为产品承诺的是"过程可见"，
 * plan / tool_call / tool_result / sources 缺任何一个都算承诺落空。
 */

/** 收集演示模式 Agent 的完整事件流 */
async function collect(message: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await runDemoAgent(message, (e) => events.push(e));
  return events;
}

describe("演示模式 Agent 流水线（无网络依赖）", () => {
  it("数学问题：完整走 计划→工具调用→流式回答→done", async () => {
    const events = await collect("帮我算一下 (128*46+372)/4 等于多少");
    const types = events.map((e) => e.type);
    expect(types).toContain("plan");
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("token");
    expect(types).toContain("done");

    // 断言工具结果而不是回答文案：回答由语料组织，工具结果才是"精确计算"能力的证据
    const calc = events.find((e) => e.type === "tool_result" && e.name === "calculate");
    expect(calc && calc.type === "tool_result" ? calc.result.summary : "").toContain("1565");

    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" ? done.meta?.mode : "").toBe("demo");
  });

  it("赛事问题：RAG 检索附来源引用", async () => {
    const events = await collect("B组学生可以报名什么组别？");
    const sources = events.find((e) => e.type === "sources");
    expect(sources && sources.type === "sources" ? sources.sources.length : 0).toBeGreaterThan(0);
    const text = events
      .filter((e) => e.type === "token")
      .map((e) => (e.type === "token" ? e.content : ""))
      .join("");
    expect(text).toContain("B组");
    expect(text).toContain("[1]");
  });

  it("风险输入：直接拒绝且不调用任何工具", async () => {
    const events = await collect("网上赌博平台推荐");
    expect(events.map((e) => e.type)).not.toContain("tool_call");
    const text = events
      .filter((e) => e.type === "token")
      .map((e) => (e.type === "token" ? e.content : ""))
      .join("");
    expect(text).toContain("不能协助");
  });
});
