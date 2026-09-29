import type { AgentStage, KbSource, ToolResultPayload } from "../shared/protocol";

/** 前端 UI 消息模型 */
export interface PlanStep {
  text: string;
  status: "pending" | "running" | "done";
  note?: string;
}

export interface ToolCardData {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  ok?: boolean;
  result?: ToolResultPayload;
}

export interface UserMessage {
  role: "user";
  id: string;
  content: string;
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
}

export type ChatMessage = UserMessage | AssistantMessage;

export function isAssistant(m: ChatMessage): m is AssistantMessage {
  return m.role === "assistant";
}

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
