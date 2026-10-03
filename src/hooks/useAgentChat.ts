import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, HealthInfo } from "../../shared/protocol";
import { isAssistant, uid, type ChatMessage, type UserMessage } from "../ui-types";

/**
 * 会话 Hook：SSE 事件流客户端 + localStorage 多会话持久化。
 *
 * 本轮优化：
 * 1. token 事件按帧节流（requestAnimationFrame 批处理），把"每个 token 一次 setState"降为"每帧一次"，
 *    长文本流式渲染的 CPU 开销显著下降；
 * 2. 新增 regenerate（重新生成）与 feedback（👍/👎），并随会话持久化；
 * 3. 停止生成时同时中断网络请求，服务端会收到 abort 并取消上游大模型调用。
 */

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORE_KEY = "zhixing.sessions.v1";

function loadStore(): StoredSession[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as StoredSession[];
    if (!Array.isArray(list)) return [];
    return list.filter((s) => s && typeof s.id === "string" && Array.isArray(s.messages));
  } catch {
    return [];
  }
}

function saveStore(list: StoredSession[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // 存储已满或不可用时静默忽略（会话仍可在内存中使用）
  }
}

function newSessionObject(): StoredSession {
  return { id: uid(), title: "新对话", updatedAt: Date.now(), messages: [] };
}

function deriveTitle(current: string, messages: ChatMessage[]): string {
  if (current !== "新对话") return current;
  const first = messages.find((m) => m.role === "user");
  if (!first) return "新对话";
  const text = first.content.trim();
  return text ? (text.length > 18 ? text.slice(0, 18) + "…" : text) : "图片对话";
}

export function useAgentChat() {
  const [sessions, setSessions] = useState<StoredSession[]>(() => {
    const list = loadStore();
    if (list.length === 0) list.push(newSessionObject());
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  });
  const [activeId, setActiveId] = useState<string>(() => sessions[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>(() => sessions[0].messages);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 供 regenerate 等回调读取最新消息，避免闭包过期
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthInfo>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // 消息变化时持久化到当前会话
  useEffect(() => {
    if (!activeId) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === activeId ? { ...s, messages, updatedAt: Date.now(), title: deriveTitle(s.title, messages) } : s,
      );
      saveStore(next);
      return next;
    });
  }, [messages, activeId]);

  const createSession = useCallback(() => {
    const s = newSessionObject();
    setSessions((prev) => {
      // 顺带清理历史遗留的空会话，避免无限堆积
      const kept = prev.filter((x) => !(x.messages.length === 0 && x.title === "新对话"));
      const next = [s, ...kept];
      saveStore(next);
      return next;
    });
    setActiveId(s.id);
    setMessages([]);
  }, []);

  const switchSession = useCallback((id: string) => {
    abortRef.current?.abort();
    setSessions((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) {
        setActiveId(id);
        setMessages(target.messages);
      }
      return prev;
    });
  }, []);

  const removeSession = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        const list = next.length > 0 ? next : [newSessionObject()];
        saveStore(list);
        if (id === activeId) {
          setActiveId(list[0].id);
          setMessages(list[0].messages);
        }
        return list;
      });
    },
    [activeId],
  );

  /** 核心发送逻辑：base 为本次请求之前的完整消息列表（支持"重新生成"） */
  const doSend = useCallback(async (text: string, images: string[] | undefined, base: ChatMessage[]) => {
    const trimmed = text.trim();
    const imgs = images && images.length > 0 ? images : undefined;
    if ((!trimmed && !imgs) || abortRef.current) return;

    // 计算历史（只保留最近 8 条非空文本消息，排除流式占位与图片轮次）
    const historyPayload = base
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

    // ---- token 按帧节流：避免每个 token 触发一次整树渲染 ----
    let tokenBuffer = "";
    let flushHandle: number | null = null;
    const flushTokens = () => {
      if (flushHandle !== null) {
        cancelAnimationFrame(flushHandle);
        flushHandle = null;
      }
      if (!tokenBuffer) return;
      const pending = tokenBuffer;
      tokenBuffer = "";
      patchAssistant((m) => (isAssistant(m) ? { ...m, content: m.content + pending } : m));
    };
    const scheduleTokenFlush = () => {
      if (flushHandle !== null) return;
      flushHandle = requestAnimationFrame(() => {
        flushHandle = null;
        if (!tokenBuffer) return;
        const pending = tokenBuffer;
        tokenBuffer = "";
        patchAssistant((m) => (isAssistant(m) ? { ...m, content: m.content + pending } : m));
      });
    };

    // 看门狗：超过 120 秒没有任何事件就主动中断，避免界面永久卡在"停止"状态
    let watchdogFired = false;
    let lastEventAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt > 120_000) {
        watchdogFired = true;
        controller.abort();
      }
    }, 5000);

    const applyEvent = (evt: AgentEvent) => {
      lastEventAt = Date.now();
      if (evt.type !== "token") flushTokens();
      switch (evt.type) {
        case "status":
          patchAssistant((m) => (isAssistant(m) ? { ...m, stage: evt.stage } : m));
          break;
        case "plan":
          patchAssistant((m) => {
            if (!isAssistant(m)) return m;
            const steps = evt.steps.map((s, i) => ({
              text: s,
              status: i === 0 ? ("done" as const) : i === 1 ? ("running" as const) : ("pending" as const),
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
          const card = { callId: evt.callId, name: evt.name, args: evt.args };
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
          tokenBuffer += evt.content;
          scheduleTokenFlush();
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
      } else if (watchdogFired) {
        patchAssistant((m) =>
          isAssistant(m)
            ? {
                ...m,
                streaming: false,
                stage: "finished",
                error: "响应超时",
                content:
                  m.content ||
                  "抱歉，本次回答等待超时了（可能是网络不稳定或服务繁忙）。请重试；若发送的是图片，可压缩后重试或改用文字描述。",
              }
            : m,
        );
      } else {
        patchAssistant((m) => (isAssistant(m) ? { ...m, streaming: false, stage: "finished" } : m));
      }
    } finally {
      flushTokens();
      clearInterval(watchdog);
      abortRef.current = null;
      setRunning(false);
      // 未收到 done 事件时兜底结束流式状态
      setMessages((prev) =>
        prev.map((m) => (isAssistant(m) && m.streaming ? { ...m, streaming: false, stage: "finished" } : m)),
      );
    }
  }, []);

  const send = useCallback(
    (text: string, images?: string[]) => doSend(text, images, messagesRef.current),
    [doSend],
  );

  /** 重新生成：以该助手消息之前的历史重发最后一条用户消息 */
  const regenerate = useCallback(
    (assistantId: string) => {
      if (abortRef.current) return;
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === assistantId);
      if (idx < 0) return;
      let u = idx - 1;
      while (u >= 0 && cur[u].role !== "user") u--;
      if (u < 0) return;
      const userMsg = cur[u] as UserMessage;
      const base = cur.slice(0, u);
      setMessages(base);
      void doSend(userMsg.content, userMsg.images, base);
    },
    [doSend],
  );

  /** 消息反馈（👍/👎），随会话持久化 */
  const rate = useCallback((assistantId: string, value: "up" | "down") => {
    setMessages((prev) =>
      prev.map((m) => (isAssistant(m) && m.id === assistantId ? { ...m, feedback: m.feedback === value ? undefined : value } : m)),
    );
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) return;
    createSession();
  }, [createSession]);

  return {
    messages,
    running,
    health,
    sessions,
    activeId,
    send,
    stop,
    reset,
    regenerate,
    rate,
    switchSession,
    removeSession,
  };
}
