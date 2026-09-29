import type { AgentEvent } from "../shared/protocol";
import { getLlmConfig, chatCompletion, chatCompletionStream, type LlmMessage, type ToolCallRequest } from "./llm";
import { toolSchemas, executeTool } from "./tools";
import { retrieve, toSources, buildKbContext, isRelevant } from "./rag";
import { screenInput, FALLBACK_REPLY } from "./safety";
import { runDemoAgent } from "./demo";
import { runVisionPath } from "./vision";

/**
 * Agent 编排器：理解 → 规划 → 行动（RAG + 工具）→ 生成 的主循环。
 * 配置了 AI_API_KEY 时调用真实大模型；否则回退到本地演示模式。
 */

type Emit = (event: AgentEvent) => void;

const MAX_TOOL_ROUNDS = 3;

const SYSTEM_PROMPT = `你是「知行 Agent」，一个会规划、会查证、会使用工具的 AI 智能助手，当前场景是为参加「传智杯 AI WEB网页开发挑战赛」的学生提供备赛咨询与日常助手服务。

工作准则：
1. 回答要简洁、结构化，重点内容用 Markdown 列表呈现。
2. 引用知识库内容时，在句子末尾标注来源编号，如 [1]、[2]。
3. 涉及数学计算必须调用 calculate 工具，不要心算。
4. 涉及"今天/现在/截止日期倒推"等时间问题，先调用 get_current_time。
5. 知识库中没有的内容，如实说明，不要编造。
6. 拒绝任何违法、违规、不安全的请求。`;

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export async function runAgent(
  userText: string,
  history: HistoryTurn[],
  images: string[] | undefined,
  emit: Emit,
): Promise<void> {
  // 图片输入走多模态通道（视觉模型直答，不走 RAG/工具）
  if (images && images.length > 0) {
    await runVisionPath(userText, images, emit);
    return;
  }

  const config = getLlmConfig();
  if (!config) {
    await runDemoAgent(userText, emit);
    return;
  }

  try {
    // 1. 输入安全过滤
    emit({ type: "status", stage: "understanding" });
    const check = screenInput(userText);
    if (!check.ok) {
      emit({ type: "token", content: check.refusal ?? FALLBACK_REPLY });
      emit({ type: "done", meta: { mode: "ai", model: config.model } });
      return;
    }

    // 2. 规划（让模型输出 JSON 计划，规划过程可视化）
    emit({ type: "status", stage: "planning" });
    const planMessages: LlmMessage[] = [
      {
        role: "system",
        content:
          '你是任务规划器。根据用户问题，输出一个 2-4 步的 JSON 执行计划，格式：{"steps":["...","..."]}，只输出 JSON。' +
          "若问题需要查赛事规则，计划中应包含「检索备赛知识库」；若包含数学计算，应包含「调用计算工具」。",
      },
      { role: "user", content: userText },
    ];
    let steps: string[] = ["理解问题", "检索知识库与调用工具", "组织回答"];
    try {
      const raw = await chatCompletion(config, planMessages);
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { steps?: string[] };
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          steps = parsed.steps.map(String).slice(0, 5);
        }
      }
    } catch {
      // 规划失败不阻塞主流程，使用默认计划
    }
    emit({ type: "plan", steps });

    // 3. RAG：先对用户问题做知识检索，把结果注入上下文（对应 RAG 技术应用评分点）
    emit({ type: "status", stage: "retrieving" });
    emit({ type: "step_update", index: 0, status: "done" });
    emit({ type: "step_update", index: 1, status: "running" });
    const hits = await retrieve(userText, 3);
    const sources = toSources(hits);
    const kbContext = buildKbContext(hits);

    if (isRelevant(userText, hits)) {
      emit({ type: "tool_call", callId: "kb-auto", name: "query_knowledge_base", args: { query: userText, topK: 3 } });
      emit({
        type: "tool_result",
        callId: "kb-auto",
        name: "query_knowledge_base",
        ok: true,
        result: {
          summary: `知识库召回 ${hits.length} 条相关内容（最高相关度 ${hits[0].score.toFixed(2)}）`,
          data: { topTitle: hits[0].chunk.title, topScore: Number(hits[0].score.toFixed(3)) },
          display: "card-kb",
        },
      });
      emit({ type: "sources", sources });
    } else {
      emit({ type: "step_update", index: 1, status: "done", note: "知识库中无高相关内容" });
    }

    // 4. 带工具的流式生成主循环
    emit({ type: "status", stage: "answering" });
    const messages: LlmMessage[] = [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          (kbContext ? `\n\n以下是检索到的知识库片段，回答相关问题时请引用（标注 [n]）：\n\n${kbContext}` : ""),
      },
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content }) as LlmMessage),
      { role: "user", content: userText },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let producedToolCall = false;
      const collectedToolCalls: ToolCallRequest[] = [];

      await chatCompletionStream(
        config,
        messages,
        toolSchemas(),
        (text) => emit({ type: "token", content: text }),
        (call) => {
          producedToolCall = true;
          collectedToolCalls.push(call);
        },
      );

      if (!producedToolCall) break;

      // 执行工具并把结果回填，进入下一轮生成
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: collectedToolCalls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of collectedToolCalls) {
        emit({ type: "tool_call", callId: call.id, name: call.name, args: safeParseArgs(call.arguments) });
        const result = await executeTool(call.name, safeParseArgs(call.arguments));
        emit({ type: "tool_result", callId: call.id, name: call.name, ok: true, result });
        messages.push({
          role: "tool",
          content: result.summary,
          tool_call_id: call.id,
          name: call.name,
        });
      }
    }

    // 5. 收尾
    emit({ type: "step_update", index: steps.length - 1, status: "done" });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  } catch (err) {
    // 兜底：任何异常都优雅降级，不把堆栈抛给用户
    emit({ type: "error", message: err instanceof Error ? err.message : "未知错误" });
    emit({ type: "token", content: "\n\n" + FALLBACK_REPLY });
    emit({ type: "done", meta: { mode: "ai", model: getLlmConfig()?.model } });
  }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
