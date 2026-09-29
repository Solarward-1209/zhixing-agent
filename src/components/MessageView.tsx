import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { STAGE_LABEL, type AssistantMessage, type ChatMessage } from "../ui-types";

/** 单条消息渲染：计划时间线 + 工具卡片 + Markdown 流式正文 + 来源引用 */
function MessageViewInner({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex animate-fade-in-up justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-indigo-600 px-4 py-2.5 text-[15px] leading-7 text-white shadow-lg shadow-indigo-950/40">
          {message.content}
        </div>
      </div>
    );
  }
  return <AssistantView message={message} />;
}

function AssistantView({ message: m }: { message: AssistantMessage }) {
  return (
    <div className="flex animate-fade-in-up items-start gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white">
        知
      </div>
      <div className="min-w-0 max-w-[85%] flex-1 space-y-2.5">
        {m.plan && <PlanTimeline message={m} />}
        {m.stage && m.streaming && !m.content && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:240ms]" />
            </span>
            {STAGE_LABEL[m.stage]}
          </div>
        )}
        {m.tools.map((t) => (
          <ToolCard key={t.callId} tool={t} />
        ))}
        {(m.content || !m.streaming) && (
          <div className="rounded-2xl rounded-tl-md border border-slate-700/60 bg-slate-800/60 px-4 py-3 shadow-lg shadow-slate-950/30">
            <div className="md-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              {m.streaming && m.content && <span className="stream-cursor" />}
            </div>
          </div>
        )}
        {m.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
            ⚠️ {m.error}
          </div>
        )}
        {m.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs leading-6 text-slate-500">引用来源：</span>
            {m.sources.map((s, i) => (
              <span
                key={s.id}
                title={s.snippet}
                className="cursor-default rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200"
              >
                [{i + 1}] {s.title}
              </span>
            ))}
          </div>
        )}
        {m.meta && (
          <div className="text-[11px] text-slate-500">
            {m.meta.mode === "demo" ? "演示模式（本地流水线，未调用大模型）" : `模型：${m.meta.model ?? "LLM"}`}
            {m.meta.mode === "demo" && " · 在 .env 配置 AI_API_KEY 后自动切换真实大模型"}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTimeline({ message: m }: { message: AssistantMessage }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-medium text-slate-300">
        <span>🗺️ Agent 执行计划</span>
        <span className="text-slate-500">（过程可视化）</span>
      </div>
      <ol className="space-y-2">
        {m.plan?.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                (step.status === "done"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : step.status === "running"
                    ? "border-2 border-indigo-400 border-t-transparent bg-transparent animate-spin"
                    : "bg-slate-700/60 text-slate-400")
              }
            >
              {step.status === "done" ? "✓" : step.status === "pending" ? i + 1 : ""}
            </span>
            <span
              className={
                "text-[13px] leading-6 " +
                (step.status === "pending" ? "text-slate-500" : "text-slate-200")
              }
            >
              {step.text}
              {step.note && <span className="ml-1.5 text-[11px] text-slate-500">· {step.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ToolCard({ tool }: { tool: { callId: string; name: string; result?: { summary: string; display?: string; data?: Record<string, unknown> } } }) {
  const r = tool.result;
  if (!r) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2.5 text-[13px] text-indigo-200">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent" />
        正在调用工具 <span className="font-mono">{tool.name}</span> …
      </div>
    );
  }
  if (r.display === "card-calc") {
    return (
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
        <div className="mb-1 text-xs text-slate-400">🧮 计算工具 · 精确求解</div>
        <div className="font-mono text-lg text-cyan-200">
          {String(r.data?.expression ?? "")} <span className="text-slate-400">=</span>{" "}
          <span className="font-semibold text-emerald-300">{String(r.data?.value ?? "?")}</span>
        </div>
      </div>
    );
  }
  if (r.display === "card-weather") {
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
        <div>
          <div className="text-xs text-slate-400">🌤️ 天气工具（模拟数据）</div>
          <div className="mt-0.5 text-[15px] font-medium text-slate-100">
            {String(r.data?.city ?? "")} · {String(r.data?.weather ?? "")}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-400">{String(r.data?.tip ?? "")}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-amber-200">{String(r.data?.temp ?? "")}</div>
        </div>
      </div>
    );
  }
  if (r.display === "card-kb") {
    return (
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2.5 text-[13px] text-cyan-100">
        📚 <span className="font-mono text-cyan-300">query_knowledge_base</span> · {r.summary}
        {r.data?.topTitle ? <span className="ml-1 text-cyan-200/80">最相关：《{String(r.data.topTitle)}》</span> : null}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3.5 py-2.5 text-[13px] text-slate-300">
      🛠️ <span className="font-mono text-slate-400">{tool.name}</span> · {r.summary}
    </div>
  );
}

export default memo(MessageViewInner);
