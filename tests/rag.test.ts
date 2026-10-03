import { describe, expect, it } from "vitest";
import { domains, isRelevant, knowledgeSize, relevanceLabel, retrieve, retrievalMode, termCoverage, toSources } from "../server/rag";

describe("知识库混合检索（BM25 + 可插拔向量）", () => {
  it("组别问题召回组别规则文档", async () => {
    const r = await retrieve("B组学生可以报名什么组别？", 3);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].chunk.id).toBe("kb-003");
  });

  it("评分问题召回评审标准文档", async () => {
    const r = await retrieve("AI技术深度的评分细则是怎样的？", 3);
    expect(["kb-007", "kb-008"]).toContain(r[0].chunk.id);
  });

  it("提交材料问题召回提交要求文档", async () => {
    const r = await retrieve("作品提交需要准备哪些材料？", 2);
    expect(["kb-005", "kb-006"]).toContain(r[0].chunk.id);
  });

  it("topK 限制返回数量", async () => {
    expect((await retrieve("报名时间", 1)).length).toBe(1);
  });

  it("混合检索分数保持在 [0,1] 区间且降序", async () => {
    const r = await retrieve("违规行为会被取消资格吗", 5);
    for (const item of r) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1.0001);
    }
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    }
  });

  it("来源映射字段完整", async () => {
    const s = toSources(await retrieve("奖项设置", 2));
    for (const src of s) {
      expect(src.id).toMatch(/^kb-\d+$/);
      expect(src.title.length).toBeGreaterThan(0);
      expect(src.snippet.length).toBeGreaterThan(0);
    }
  });

  it("检索模式可解释（bm25 或 bm25+vector）", () => {
    expect(["bm25", "bm25+vector"]).toContain(retrievalMode());
  });

  it("相关性判断：赛事问题命中，无关问题不命中", async () => {
    expect(isRelevant("B组学生可以报名什么组别？", await retrieve("B组学生可以报名什么组别？", 3))).toBe(true);
    expect(isRelevant("作品提交需要准备哪些材料？", await retrieve("作品提交需要准备哪些材料？", 3))).toBe(true);
    expect(isRelevant("今天中午吃什么饭比较好呢", await retrieve("今天中午吃什么饭比较好呢", 3))).toBe(false);
    expect(isRelevant("帮我写一首诗", await retrieve("帮我写一首诗", 3))).toBe(false);
  });

  it("原始分数被保留，不再是「最高分恒为 1.00」的假指标", async () => {
    const r = await retrieve("评审标准与权重", 3);
    expect(r[0].score).toBeCloseTo(1, 5); // 归一化展示分
    expect(r[0].rawScore).toBeGreaterThan(0); // 真实融合分
    const label = relevanceLabel("评审标准与权重", r);
    expect(label).toMatch(/词项覆盖率 \d+%/);
    expect(label).not.toContain("1.00");
  });

  it("词项覆盖率可解释且落在 [0,1]", () => {
    const c = termCoverage("B组报名规则", "参赛组别与报名规则", "B组适用于普通本科院校学生。");
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
    expect(termCoverage("完全无关的提问", "参赛组别与报名规则", "B组适用于普通本科院校学生。")).toBeLessThan(0.2);
  });

  it("知识库规模可被 /api/health 读取", () => {
    expect(knowledgeSize()).toBeGreaterThanOrEqual(45);
  });
});

describe("多知识域检索（场景可迁移）", () => {
  it("至少挂载两个知识域，且各自有独立语料", () => {
    const list = domains();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((d) => d.id);
    expect(ids).toContain("competition");
    expect(ids).toContain("campus");
    for (const d of list) expect(d.chunks).toBeGreaterThan(0);
  });

  it("限定校园域时只召回校园语料", async () => {
    const r = await retrieve("选课流程与退改选规则", 3, { domain: "campus" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((item) => item.chunk.domain === "campus")).toBe(true);
    expect(r[0].chunk.id).toMatch(/^campus-/);
  });

  it("限定赛事域时只召回赛事语料", async () => {
    const r = await retrieve("评审标准与权重", 3, { domain: "competition" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((item) => item.chunk.domain === "competition")).toBe(true);
    expect(r[0].chunk.id).toMatch(/^kb-/);
  });

  it("跨域检索（all）可同时覆盖两个域", async () => {
    const campus = await retrieve("保研推免流程", 3);
    expect(campus[0].chunk.domain).toBe("campus");
  });

  it("相关度标签会标注所属知识域", async () => {
    const r = await retrieve("学分与毕业要求", 2, { domain: "campus" });
    expect(relevanceLabel("学分与毕业要求", r)).toContain("校园学习");
  });
});
