import { describe, expect, it } from "vitest";
import { retrieve, toSources } from "../server/rag";

describe("知识库检索（RAG）", () => {
  it("组别问题召回组别规则文档", () => {
    const r = retrieve("B组学生可以报名什么组别？", 3);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].chunk.id).toBe("kb-003");
  });

  it("评分问题召回评审标准文档", () => {
    const r = retrieve("AI技术深度的评分细则是怎样的？", 3);
    expect(["kb-007", "kb-008"]).toContain(r[0].chunk.id);
  });

  it("提交材料问题召回提交要求文档", () => {
    const r = retrieve("作品提交需要准备哪些材料？", 2);
    expect(["kb-005", "kb-006"]).toContain(r[0].chunk.id);
  });

  it("topK 限制返回数量", () => {
    expect(retrieve("报名时间", 1).length).toBe(1);
  });

  it("来源映射字段完整", () => {
    const s = toSources(retrieve("奖项设置", 2));
    for (const src of s) {
      expect(src.id).toMatch(/^kb-\d+$/);
      expect(src.title.length).toBeGreaterThan(0);
      expect(src.snippet.length).toBeGreaterThan(0);
    }
  });
});
