import type { AgentEvent } from "../shared/protocol";
import { retrieve, toSources, isRelevant, relevanceLabel } from "./rag";
import { executeTool } from "./tools";
import { screenInput, applyDisclaimer, FALLBACK_REPLY } from "./safety";

/**
 * 本地演示模式（未配置 API Key 时启用）：
 * 完整走一遍「规划 → RAG 检索 → 工具调用 → 流式回答」的 Agent 流水线，
 * 其中检索与工具是真实执行，回答由知识库原文要点组织（不做无依据编造），
 * 用于在没有大模型 Key 时也能完整呈现产品交互与架构。
 */

type Emit = (event: AgentEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 演示模式强制使用离线样例天气，保证无网络环境下流水线可复现 */
const DEMO_TOOL_CTX = { weatherMode: "mock" } as const;

async function streamText(emit: Emit, text: string): Promise<void> {
  // 按小块流式输出，模拟 token 流
  const chunks = text.match(/[\s\S]{1,4}/g) ?? [];
  for (const c of chunks) {
    emit({ type: "token", content: c });
    await sleep(12 + Math.random() * 18);
  }
}

interface Intent {
  kinds: Array<"kb" | "math" | "time" | "weather">;
  expression?: string;
  city?: string;
}

function detectIntent(text: string): Intent {
  const kinds: Intent["kinds"] = [];
  // 数学表达式：包含运算符的数字串
  const mathMatch = text.match(/[-(]?\d[\d\s.+\-*/%()×÷]*\d\)?|\d+(?:\.\d+)?\s*[-+*/%]\s*\d+(?:\.\d+)?/);
  if (mathMatch && /[+\-*/%×÷]/.test(mathMatch[0]) && /\d/.test(mathMatch[0])) {
    kinds.push("math");
  } else if (/^(帮我)?(算|计算)/.test(text.trim())) {
    kinds.push("math");
  }
  if (/天气|气温|下雨|温度/.test(text)) kinds.push("weather");
  if (/几点|现在时间|今天几号|日期|星期|今天.*号|截止.*还有|还有多少天/.test(text)) kinds.push("time");
  if (kinds.length === 0 || /大赛|赛事|比赛|传智杯|组别|报名|提交|评分|评审|奖项|技术栈|命题|违规/.test(text)) {
    kinds.unshift("kb");
  }
  return { kinds };
}

function extractSentences(text: string, query: string, max: number): string[] {
  const terms = new Set<string>();
  const chars = query.replace(/\s+/g, "");
  for (let i = 0; i < chars.length - 1; i++) terms.add(chars.slice(i, i + 2));
  const parts = text
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  parts.sort((a, b) => {
    const hits = (s: string) => [...terms].filter((t) => s.includes(t)).length;
    return hits(b) - hits(a);
  });
  return parts.slice(0, max).map((s) => (s.length > 90 ? s.slice(0, 90) + "…" : s));
}

export async function runDemoAgent(userText: string, emit: Emit): Promise<void> {
  // 1. 安全过滤
  emit({ type: "status", stage: "understanding" });
  const check = screenInput(userText);
  if (!check.ok) {
    emit({ type: "error", message: `内容安全拦截：${check.reason ?? "命中风险规则"}` });
    await streamText(emit, check.refusal ?? FALLBACK_REPLY);
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "demo" } });
    return;
  }
  await sleep(300);

  // 2. 生成计划
  emit({ type: "status", stage: "planning" });
  await sleep(200);
  const intent = detectIntent(userText);
  const steps: string[] = ["理解问题意图"];
  if (intent.kinds.includes("kb")) steps.push("检索备赛知识库（RAG）");
  if (intent.kinds.includes("time")) steps.push("调用时间工具获取当前日期");
  if (intent.kinds.includes("weather")) steps.push("调用天气工具查询城市天气");
  if (intent.kinds.includes("math")) steps.push("调用计算工具精确求解");
  steps.push("整合信息，组织回答");
  emit({ type: "plan", steps });

  let stepIdx = 0;
  const runStep = async (note?: string) => {
    emit({ type: "step_update", index: stepIdx, status: "running", note });
    await sleep(350 + Math.random() * 250);
    emit({ type: "step_update", index: stepIdx, status: "done" });
    stepIdx += 1;
  };

  await runStep();

  const sections: string[] = [];
  let hasKb = false;

  // 3. RAG 检索（真实执行）
  if (intent.kinds.includes("kb")) {
    emit({ type: "status", stage: "retrieving" });
    const results = await retrieve(userText, 3);
    await runStep(relevanceLabel(userText, results));

    if (isRelevant(userText, results)) {
      emit({ type: "tool_call", callId: "kb-1", name: "query_knowledge_base", args: { query: userText, topK: 3 } });
      emit({
        type: "tool_result",
        callId: "kb-1",
        name: "query_knowledge_base",
        ok: true,
        result: {
          summary: `知识库${relevanceLabel(userText, results)}（最相关：《${results[0].chunk.title}》）`,
          data: { topTitle: results[0].chunk.title, topScore: Number(results[0].rawScore.toFixed(3)) },
          display: "card-kb",
        },
      });
      emit({ type: "sources", sources: toSources(results) });
      hasKb = true;

      let body = `根据「传智杯备赛知识库」的检索结果，为你整理如下要点：\n\n`;
      results.forEach((r, i) => {
        const sents = extractSentences(r.chunk.text, userText, 2);
        body += `**${i + 1}. ${r.chunk.title}**\n`;
        sents.forEach((s) => {
          body += `- ${s} [${i + 1}]\n`;
        });
        body += `\n`;
      });
      body += `以上均引用自知识库原文（见下方来源卡片），可以继续追问细节，比如「B组报名规则」「评分标准」「提交材料要求」。`;
      sections.push(body);
    }
  }

  // 4. 工具调用
  if (intent.kinds.includes("time")) {
    emit({ type: "status", stage: "tooling" });
    emit({ type: "tool_call", callId: "t-1", name: "get_current_time", args: {} });
    const result = await executeTool("get_current_time", {}, DEMO_TOOL_CTX);
    emit({ type: "tool_result", callId: "t-1", name: "get_current_time", ok: true, result });
    await runStep(result.summary);
    sections.push(`${result.summary}。`);
  }

  if (intent.kinds.includes("weather")) {
    emit({ type: "status", stage: "tooling" });
    const cityMatch = userText.match(/(北京|上海|广州|深圳|杭州|成都|南京|武汉|西安|重庆)/);
    const city = cityMatch ? cityMatch[1] : "北京";
    emit({ type: "tool_call", callId: "w-1", name: "get_weather", args: { city } });
    const result = await executeTool("get_weather", { city }, DEMO_TOOL_CTX);
    emit({ type: "tool_result", callId: "w-1", name: "get_weather", ok: true, result });
    await runStep(result.summary);
    sections.push(`${result.summary}。${city}今日出行提示：注意天气变化，合理安排出行～`);
  }

  if (intent.kinds.includes("math")) {
    emit({ type: "status", stage: "tooling" });
    const mathMatch = userText.match(/[-(]?\d[\d\s.+\-*/%()×÷]*\d\)?|\d+(?:\.\d+)?\s*[-+*/%]\s*\d+(?:\.\d+)?/);
    const expression = (mathMatch ? mathMatch[0] : userText.replace(/[^0-9+\-*/%().×÷]/g, "")).replace(/×/g, "*").replace(/÷/g, "/");
    emit({ type: "tool_call", callId: "c-1", name: "calculate", args: { expression } });
    const result = await executeTool("calculate", { expression }, DEMO_TOOL_CTX);
    emit({ type: "tool_result", callId: "c-1", name: "calculate", ok: true, result });
    await runStep(result.summary);
    sections.push(
      `计算结果：**${result.summary}**\n\n这个结果由本地计算工具精确求解，而不是模型"心算"，可以避免大模型做复杂数学时的精度问题。`,
    );
  }

  // 5. 组织回答
  emit({ type: "status", stage: "answering" });
  await runStep();

  let answer: string;
  if (sections.length > 0) {
    answer = sections.join("\n\n---\n\n");
    if (!hasKb && intent.kinds.length === 1 && intent.kinds[0] !== "kb") {
      answer += `\n\n💡 顺带提示：你也可以问我传智杯的报名、组别、评分、提交要求等备赛问题。`;
    }
  } else {
    answer =
      `我在「传智杯备赛知识库」里没有找到与这个问题高度相关的内容。\n\n` +
      `目前我比较擅长：\n\n` +
      `- 📋 赛事咨询：报名时间、组别规则、评分标准、提交材料、奖项设置\n` +
      `- 🧮 精确计算：四则运算表达式求值\n` +
      `- ⏰ 日期时间：今天几号、星期几\n` +
      `- 🌤️ 天气查询：主要城市天气（演示数据）\n\n` +
      `试着问我：「AI技术深度的评分细则是怎样的？」`;
  }
  answer = applyDisclaimer(answer);
  await streamText(emit, answer);

  emit({ type: "status", stage: "finished" });
  emit({ type: "done", meta: { mode: "demo" } });
}
