import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, HealthInfo } from "../../shared/protocol";
import { isAssistant, uid, type ChatMessage, type PlanStep, type ToolCardData } from "../ui-types";

/**
 * 会话 Hook：负责向 /api/chat 发起 SSE 请求，并把 Agent 事件流
 * （status / plan / tool_call / token / sources…）增量应用到消息列表上。
 */
export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthInfo>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const send = useCallback(
    async (text: string, images?: string[]) => {
      const trimmed = text.trim();
      const imgs = images && images.length > 0 ? images : undefined;
      if ((!trimmed && !imgs) || abortRef.current) return;

      // 计算历史（只保留最近 8 条，排除流式占位）
      const historyPayload = messages
        .map((m) =>
          m.role === "user"
            ? { role: "user" as const, content: m.content }
            : isAssistant(m) && !m.streaming && m.content.trim().length > 0
              ? { role: "assistant" as const, content: m.content }
              : null,
        )
        .filter((h): h is { role: "user" | "assistant"; content: string } => h !== null)
        .filter((h) => h.content.trim().length > 0)
        .slice(-8);

      const userMsg: ChatMessage = { role: "user", id: uid(), content: trimmed, images: imgs };
      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        role: "assistant",
        id: assistantId,
        content: "",
        streaming: true,
        stage: "understanding",
        tools: [],
        sources: [],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = patch(next[idx]);
          return next;
        });
      };

      const applyEvent = (evt: AgentEvent) => {
        switch (evt.type) {
          case "status":
            patchAssistant((m) => (isAssistant(m) ? { ...m, stage: evt.stage } : m));
            break;
          case "plan":
            patchAssistant((m) => {
              if (!isAssistant(m)) return m;
              const steps: PlanStep[] = evt.steps.map((s, i) => ({
                text: s,
                status: i === 0 ? "done" : i === 1 ? "running" : "pending",
              }));
              return { ...m, plan: steps };
            });
            break;
          case "step_update":
            patchAssistant((m) => {
              if (!isAssistant(m) || !m.plan) return m;
              const plan = m.plan.map((s, i) =>
                i === evt.index ? { ...s, status: evt.status, note: evt.note ?? s.note } : s,
              );
              return { ...m, plan };
            });
            break;
          case "tool_call": {
            const card: ToolCardData = { callId: evt.callId, name: evt.name, args: evt.args };
            patchAssistant((m) => (isAssistant(m) ? { ...m, tools: [...m.tools, card] } : m));
            break;
          }
          case "tool_result":
            patchAssistant((m) => {
              if (!isAssistant(m)) return m;
              const tools = m.tools.map((t) =>
                t.callId === evt.callId ? { ...t, ok: evt.ok, result: evt.result } : t,
              );
              return { ...m, tools };
            });
            break;
          case "token":
            patchAssistant((m) => (isAssistant(m) ? { ...m, content: m.content + evt.content } : m));
            break;
          case "sources":
            patchAssistant((m) => (isAssistant(m) ? { ...m, sources: evt.sources } : m));
            break;
          case "error":
            patchAssistant((m) => (isAssistant(m) ? { ...m, error: evt.message } : m));
            break;
          case "done":
            patchAssistant((m) =>
              isAssistant(m) ? { ...m, streaming: false, stage: "finished", meta: evt.meta } : m,
            );
            break;
        }
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history: historyPayload, images: imgs }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`请求失败：HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              try {
                applyEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
              } catch {
                // 忽略无法解析的行
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchAssistant((m) =>
            isAssistant(m)
              ? {
                  ...m,
                  streaming: false,
                  stage: "finished",
                  error: `网络异常：${err instanceof Error ? err.message : "未知错误"}`,
                  content:
                    m.content ||
                    "抱歉，与服务器的连接中断了。请检查网络后重试；如果问题持续，请刷新页面。",
                }
              : m,
          );
        } else {
          patchAssistant((m) => (isAssistant(m) ? { ...m, streaming: false, stage: "finished" } : m));
        }
      } finally {
        abortRef.current = null;
        setRunning(false);
        // 未收到 done 事件时兜底结束流式状态
        setMessages((prev) =>
          prev.map((m) => (isAssistant(m) && m.streaming ? { ...m, streaming: false, stage: "finished" } : m)),
        );
      }
    },
    [messages],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) return;
    setMessages([]);
  }, []);

  return { messages, running, health, send, stop, reset };
}
