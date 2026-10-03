import type { AgentEvent } from "../shared/protocol";
import { getLlmConfig, chatCompletion, chatCompletionStream, type LlmMessage, type ToolCallRequest } from "./llm";
import { listToolSchemas, executeTool, type ToolContext } from "./tools";
import { retrieve, toSources, buildKbContext, isRelevant, relevanceLabel } from "./rag";
import { screenInput, applyDisclaimer, redactSecrets, FALLBACK_REPLY } from "./safety";
import { runDemoAgent } from "./demo";
import { runVisionPath } from "./vision";

/**
 * Agent 编排器：理解 → 规划 → 行动（图片理解 / RAG / 工具）→ 生成 的主循环。
 * 配置了 AI_API_KEY 时调用真实大模型；否则回退到本地演示模式。
 *
 * 本轮迭代修复的关键问题：
 * 1. 安全过滤提前到最前（含图片路径），拦截时补发 error 事件；
 * 2. 计划步骤与真实执行动作动态映射（不再硬编码 index 0/1），找不到对应步骤就不发假进度；
 * 3. 工具执行期间补发 status: tooling，阶段指示与实际动作一致；
 * 4. 真实模式同样执行免责声明与输出侧密钥遮蔽；
 * 5. 图片理解作为 understand_image 工具进入主循环（可与 RAG/工具协同），实现多模态融合；
 * 6. 全链路透传 AbortSignal，用户点「停止」或断开连接可立即取消上游请求。
 */

type Emit = (event: AgentEvent) => void;

const MAX_TOOL_ROUNDS = 3;

const SYSTEM_PROMPT = `你是「知行 Agent」，一个会规划、会查证、会使用工具的 AI 智能助手，当前场景是为参加「传智杯 AI WEB网页开发挑战赛」的学生提供备赛咨询与日常助手服务。

工作准则：
1. 语言：始终使用简体中文回答（专有名词、代码、命令可保留英文），不要中英混杂。
2. 结构：回答简洁、结构化，重点内容用 Markdown 列表或小标题呈现，不要长篇空话。
3. 引用：引用知识库内容时在句末标注来源编号，如 [1]、[2]；没有检索到依据时如实说明，不要编造赛事规则、时间或数字。
4. 工具：涉及数学计算必须调用 calculate；涉及"今天/现在/截止日期倒推"必须先调用 get_current_time；涉及天气必须调用 get_weather；本轮带图片时先调用 understand_image 获取图片内容。工具返回失败时，如实告诉用户失败原因，不要用记忆中的数据顶替。
5. 诚实：知识库与工具都没有的数据，直接说"我暂时没有查到"，不要猜测。
6. 安全：拒绝任何违法、违规、不安全的请求。`;

const PLANNER_PROMPT =
  '你是任务规划器。根据用户问题，输出一个 2-4 步的 JSON 执行计划，格式：{"steps":["...","..."]}，只输出 JSON，不要解释。' +
  "若问题需要查赛事规则或项目资料，计划中必须包含含「检索」字样的步骤；" +
  "若包含数学计算，必须包含含「计算」字样的步骤；" +
  "若包含日期时间推算，必须包含含「时间」字样的步骤；" +
  "若用户上传了图片，必须把「识别图片内容」作为第一步。";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RunAgentOptions {
  /** 外部取消信号（用户停止 / 连接断开） */
  signal?: AbortSignal;
  /** 知识域：competition / campus / all */
  domain?: string;
}

// ---------- 计划步骤追踪：让"可视化"与真实执行严格对应 ----------

class PlanTracker {
  private status: Array<"pending" | "running" | "done">;

  constructor(
    private readonly steps: string[],
    private readonly emit: Emit,
  ) {
    this.status = steps.map(() => "pending");
  }

  private update(index: number, status: "running" | "done", note?: string): void {
    if (index < 0 || index >= this.steps.length) return;
    if (this.status[index] === status || this.status[index] === "done") return;
    // 同一时刻只允许一个步骤处于 running
    if (status === "running") {
      this.status = this.status.map((s) => (s === "running" ? "pending" : s));
    }
    this.status[index] = status;
    this.emit({ type: "step_update", index, status, note });
  }

  /** 按关键词定位步骤；找不到返回 -1（此时不发事件，避免出现张冠李戴的进度） */
  find(keywords: string[]): number {
    return this.steps.findIndex((s) => keywords.some((k) => s.includes(k)));
  }

  start(keywords: string[], note?: string): number {
    const idx = this.find(keywords);
    if (idx >= 0) this.update(idx, "running", note);
    return idx;
  }

  finish(keywords: string[], note?: string): number {
    const idx = this.find(keywords);
    if (idx >= 0) this.update(idx, "done", note);
    return idx;
  }

  /** 收尾：把仍未完成的步骤按顺序补完，避免时间线永远卡在"进行中" */
  completeAll(): void {
    this.steps.forEach((_, i) => {
      if (this.status[i] !== "done") this.update(i, "done");
    });
  }
}

// ---------- 输出守卫：流式文档的密钥遮蔽 + 结尾免责声明 ----------

class OutputGuard {
  /** 保留尾部若干字符，避免密钥等敏感串跨 chunk 漏网 */
  private static readonly HOLD = 64;
  private tail = "";
  private full = "";
  private emitted = 0;

  constructor(private readonly emit: Emit) {}

  push(text: string): void {
    this.full += text;
    const buf = this.tail + text;
    if (buf.length <= OutputGuard.HOLD) {
      this.tail = buf;
      return;
    }
    const ready = buf.slice(0, buf.length - OutputGuard.HOLD);
    this.tail = buf.slice(buf.length - OutputGuard.HOLD);
    this.flush(ready);
    this.emitted += ready.length;
  }

  private flush(text: string): void {
    const { text: safe } = redactSecrets(text);
    if (safe) this.emit({ type: "token", content: safe });
  }

  /** 收尾：冲刷尾部、追加免责声明，返回最终完整文本 */
  finish(): string {
    this.flush(this.tail);
    this.tail = "";

    const withDisclaimer = applyDisclaimer(this.full);
    const appended = withDisclaimer.slice(this.full.length);
    if (appended) this.emit({ type: "token", content: appended });
    this.emitted = withDisclaimer.length;
    return withDisclaimer;
  }

  get length(): number {
    return this.emitted;
  }
}

/** 工具 → 计划步骤关键词：让每一次工具调用都能点亮对应的计划步骤（而不是笼统地标同一个） */
const TOOL_STEP_KEYWORDS: Record<string, string[]> = {
  calculate: ["计算", "数学"],
  get_current_time: ["时间", "日期", "今天"],
  get_weather: ["天气", "气温"],
  understand_image: ["图片", "图像", "识图", "视觉"],
  query_knowledge_base: ["检索", "知识", "查证"],
};

function isToolFailure(result: { summary: string; data?: Record<string, unknown> }): boolean {
  if (result.data && result.data.failed === true) return true;
  if (result.data && result.data.isError === true) return true;
  return /^(计算失败|天气查询失败|未知工具|工具执行出错|图片理解失败|尚未配置)/.test(result.summary);
}

export async function runAgent(
  userText: string,
  history: HistoryTurn[],
  images: string[] | undefined,
  emit: Emit,
  options: RunAgentOptions = {},
): Promise<void> {
  const signal = options.signal;
  const domain = options.domain ?? "all";
  const hasImages = Array.isArray(images) && images.length > 0;
  const config = getLlmConfig();

  // 1. 输入安全过滤（所有路径统一前置，包括图片路径）
  emit({ type: "status", stage: "understanding" });
  const check = screenInput(userText || (hasImages ? "请描述这张图片" : ""));
  if (!check.ok) {
    emit({ type: "error", message: `内容安全拦截：${check.reason ?? "命中风险规则"}` });
    emit({ type: "token", content: check.refusal ?? FALLBACK_REPLY });
    emit({ type: "done", meta: { mode: config ? "ai" : "demo", model: config?.model } });
    return;
  }

  // 2. 未配置大模型：图片走视觉通道，纯文本走本地演示模式
  if (!config) {
    if (hasImages) {
      await runVisionPath(userText, images ?? [], emit, signal);
      return;
    }
    await runDemoAgent(userText, emit, { domain });
    return;
  }

  const toolCtx: ToolContext = { images, signal };

  try {
    // 3. 规划（让模型输出 JSON 计划，规划过程可视化）
    emit({ type: "status", stage: "planning" });
    const planMessages: LlmMessage[] = [
      { role: "system", content: PLANNER_PROMPT + (hasImages ? "（本轮用户上传了图片）" : "") },
      { role: "user", content: userText || "请描述这张图片" },
    ];
    let steps: string[] = hasImages ? ["识别图片内容", "检索知识库与调用工具", "组织回答"] : ["理解问题", "检索知识库与调用工具", "组织回答"];
    try {
      const raw = await chatCompletion(config, planMessages, { signal, timeoutMs: config.timeoutMs, maxRetries: 1 });
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { steps?: unknown };
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          steps = parsed.steps.map(String).slice(0, 5);
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // 规划失败不阻塞主流程，使用默认计划
    }
    emit({ type: "plan", steps });
    const tracker = new PlanTracker(steps, emit);
    tracker.start(["理解", "分析"]);
    tracker.finish(["理解", "分析"]);

    // 4. 图片理解：作为工具进入主循环（可与后续 RAG / 工具协同）
    let visionContext = "";
    if (hasImages) {
      tracker.start(["图片", "图像", "识图", "视觉"]);
      emit({ type: "status", stage: "tooling" });
      emit({
        type: "tool_call",
        callId: "image-auto",
        name: "understand_image",
        args: { question: userText || "请描述图片内容并转录其中的关键文字" },
      });
      const imageResult = await executeTool(
        "understand_image",
        { question: userText || "请描述图片内容并转录其中的关键文字" },
        toolCtx,
      );
      emit({
        type: "tool_result",
        callId: "image-auto",
        name: "understand_image",
        ok: !isToolFailure(imageResult),
        result: imageResult,
      });
      const description = typeof imageResult.data?.description === "string" ? imageResult.data.description : "";
      if (description) visionContext = description;
      tracker.finish(["图片", "图像", "识图", "视觉"]);
    }

    // 5. RAG：检索知识库并注入上下文（对应 RAG 技术应用评分点）
    emit({ type: "status", stage: "retrieving" });
    tracker.start(["检索", "查证", "知识"]);
    const hits = await retrieve(userText || "图片内容", 3, { domain });
    const sources = toSources(hits);
    const kbContext = buildKbContext(hits);
    const relevant = isRelevant(userText || "图片内容", hits);

    if (relevant && hits.length > 0) {
      emit({
        type: "tool_call",
        callId: "kb-auto",
        name: "query_knowledge_base",
        args: { query: userText, topK: 3 },
      });
      emit({
        type: "tool_result",
        callId: "kb-auto",
        name: "query_knowledge_base",
        ok: true,
        result: {
          summary: `知识库${relevanceLabel(userText || "图片内容", hits)}（最相关：《${hits[0].chunk.title}》）`,
          data: { topTitle: hits[0].chunk.title, topScore: Number(hits[0].rawScore.toFixed(3)) },
          display: "card-kb",
        },
      });
      emit({ type: "sources", sources });
    } else {
      // 即使不相关也明确告知"已检索、无高相关内容"，信息透明
      emit({ type: "sources", sources: [] });
      tracker.finish(["检索", "查证", "知识"], "知识库中无高相关内容");
    }
    tracker.finish(["检索", "查证", "知识"]);

    // 6. 带工具的流式生成主循环
    emit({ type: "status", stage: "answering" });
    const domainName = domain === "all" ? "全部知识域" : domain === "campus" ? "校园学习" : "赛事备赛";
    const systemParts = [SYSTEM_PROMPT];
    systemParts.push(`\n\n【本次对话挂载的知识域】${domainName}。若检索结果为空或与问题无关，请说明"当前知识域中没有相关资料"，不要用记忆中的数据顶替。`);
    if (visionContext) systemParts.push(`\n\n【用户上传图片的理解结果】\n${visionContext}\n（以上由视觉模型生成，回答图片相关问题时请基于它，不要臆测图中不存在的内容。）`);
    if (kbContext) systemParts.push(`\n\n【检索到的知识库片段】回答相关问题时请引用（标注 [n]）：\n\n${kbContext}`);
    if (hasImages) systemParts.push("\n\n注意：本轮对话包含用户上传的图片。若已有图片理解结果，直接使用即可；如需更细的信息可再次调用 understand_image。");

    const messages: LlmMessage[] = [
      { role: "system", content: systemParts.join("") },
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content }) as LlmMessage),
      { role: "user", content: userText || "请描述这张图片" },
    ];

    const guard = new OutputGuard(emit);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) break;
      let producedToolCall = false;
      const collectedToolCalls: ToolCallRequest[] = [];

      const activeTools = await listToolSchemas({ signal });
      await chatCompletionStream(
        config,
        messages,
        activeTools,
        (text) => guard.push(text),
        (call) => {
          producedToolCall = true;
          collectedToolCalls.push(call);
        },
        { signal, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries },
      );

      if (signal?.aborted) break;
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
        const stepKeywords = TOOL_STEP_KEYWORDS[call.name] ?? [];
        if (stepKeywords.length > 0) tracker.start(stepKeywords);
        emit({ type: "status", stage: "tooling" });
        const args = safeParseArgs(call.arguments);
        emit({ type: "tool_call", callId: call.id, name: call.name, args });
        const result = await executeTool(call.name, args, toolCtx);
        emit({ type: "tool_result", callId: call.id, name: call.name, ok: !isToolFailure(result), result });
        if (stepKeywords.length > 0) tracker.finish(stepKeywords);
        messages.push({
          role: "tool",
          content: result.summary,
          tool_call_id: call.id,
          name: call.name,
        });
      }
      emit({ type: "status", stage: "answering" });
    }

    // 7. 收尾：补全计划、输出免责声明、结束
    tracker.start(["组织", "整合", "回答", "总结"]);
    guard.finish();
    tracker.completeAll();
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && /取消/.test(err.message))) {
      emit({ type: "status", stage: "finished" });
      emit({ type: "done", meta: { mode: "ai", model: config.model } });
      return;
    }
    // 兜底：任何异常都优雅降级，不把堆栈抛给用户
    emit({ type: "error", message: err instanceof Error ? err.message : "未知错误" });
    emit({ type: "token", content: "\n\n" + FALLBACK_REPLY });
    emit({ type: "status", stage: "finished" });
    emit({ type: "done", meta: { mode: "ai", model: config.model } });
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
