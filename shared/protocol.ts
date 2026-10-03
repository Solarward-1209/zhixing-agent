/**
 * 前后端共享的 Agent 事件协议。
 * 服务端通过 SSE（Server-Sent Events）把 Agent 的执行过程以事件流推给前端，
 * 前端据此渲染「计划 → 工具调用 → 流式回答 → 引用来源」的全过程。
 */

/** Agent 执行阶段（用于顶部状态条的思考可视化） */
export type AgentStage =
  | "understanding" // 理解问题
  | "planning" // 生成执行计划
  | "retrieving" // 检索知识库（RAG）
  | "tooling" // 调用外部工具（含图片理解）
  | "answering" // 生成回答
  | "finished";

/** 知识库引用来源 */
export interface KbSource {
  id: string;
  title: string;
  snippet: string;
}

/** 工具结果载荷：summary 用于摘要文案，display 决定前端卡片样式 */
export interface ToolResultPayload {
  summary: string;
  data?: Record<string, unknown>;
  display?: "card-weather" | "card-calc" | "card-kb" | "card-vision" | "plain";
}

export type AgentEvent =
  /** 阶段状态变化 */
  | { type: "status"; stage: AgentStage }
  /** 执行计划（规划可视化） */
  | { type: "plan"; steps: string[] }
  | { type: "step_update"; index: number; status: "running" | "done"; note?: string }
  /** 工具调用 */
  | { type: "tool_call"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; name: string; ok: boolean; result: ToolResultPayload }
  /** 回答 token 流 */
  | { type: "token"; content: string }
  /** 本轮回答引用的知识库来源（空数组表示"已检索但无高相关内容"） */
  | { type: "sources"; sources: KbSource[] }
  | { type: "error"; message: string }
  | { type: "done"; meta?: { mode: "demo" | "ai"; model?: string } };

/** 一次会话请求 */
export interface ChatRequestBody {
  message: string;
  /** 历史对话（最近若干轮），role 仅为 user / assistant */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** 可选图片（data URL），存在时由 Agent 自主调用图片理解工具 */
  images?: string[];
}

/** /api/health 返回：告知前端当前运行在真实大模型还是本地演示模式 */
export interface HealthInfo {
  mode: "demo" | "ai";
  provider?: string;
  model?: string;
  /** 检索模式：bm25（本地）或 bm25+vector（配置了 Embedding Key 的混合检索） */
  retrieval?: "bm25" | "bm25+vector";
  /** 是否已配置视觉模型（决定图片输入是否可用） */
  vision?: boolean;
  /** 知识库规模，便于前端展示与评审核对 */
  knowledgeChunks?: number;
}
