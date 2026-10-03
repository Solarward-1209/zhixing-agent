import type { AgentStage, KbSource, ToolResultPayload } from "../shared/protocol";

/**
 * 前端 UI 消息模型。
 *
 * 与 shared/protocol.ts 的分工：protocol.ts 描述"服务端推送什么事件"（传输契约），
 * 本文件描述"界面需要持有什么状态"（渲染模型）。两者刻意解耦——
 * 协议演进时，UI 只需在 useAgentChat 的事件处理里做一次映射。
 */
export interface PlanStep {
  text: string;
  status: "pending" | "running" | "done";
  note?: string;
}

/** 工具卡片数据：先由 tool_call 建卡（无 result，显示加载态），再由 tool_result 回填 */
export interface ToolCardData {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** 由 tool_result 给出；缺省表示仍在调用中 */
  ok?: boolean;
  result?: ToolResultPayload;
}

export interface UserMessage {
  role: "user";
  id: string;
  content: string;
  /** 随消息发送的图片（data URL），仅当前消息有效 */
  images?: string[];
}

export interface AssistantMessage {
  role: "assistant";
  id: string;
  content: string;
  streaming: boolean;
  stage?: AgentStage;
  plan?: PlanStep[];
  tools: ToolCardData[];
  sources: KbSource[];
  error?: string;
  meta?: { mode: "demo" | "ai"; model?: string };
  /** 用户反馈（👍/👎），随会话持久化，可用于后续效果评估 */
  feedback?: "up" | "down";
}

export type ChatMessage = UserMessage | AssistantMessage;

/** 类型守卫：把联合类型收窄为 AssistantMessage，避免在事件处理里到处断言 */
export function isAssistant(m: ChatMessage): m is AssistantMessage {
  return m.role === "assistant";
}

/**
 * 阶段文案。Record<AgentStage, string> 的作用是穷尽性检查：
 * protocol 里新增一个阶段而这里没补文案时，TypeScript 会直接编译失败。
 */
export const STAGE_LABEL: Record<AgentStage, string> = {
  understanding: "正在理解问题…",
  planning: "正在制定执行计划…",
  retrieving: "正在检索知识库…",
  tooling: "正在调用工具…",
  answering: "正在生成回答…",
  finished: "已完成",
};

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
