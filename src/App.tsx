import { useEffect, useRef } from "react";
import { useAgentChat } from "./hooks/useAgentChat";
import Sidebar from "./components/Sidebar";
import ChatInput from "./components/ChatInput";
import MessageView from "./components/MessageView";

const SUGGESTIONS = [
  { icon: "🏆", title: "赛事咨询", text: "传智杯的报名截止时间是什么时候？评审标准是怎样的？" },
  { icon: "🧮", title: "精确计算", text: "帮我算一下 (128*46+372)/4 等于多少" },
  { icon: "⏰", title: "日期时间", text: "今天几号？现在离作品提交截止还有多久？" },
  { icon: "🌤️", title: "工具调用", text: "北京今天天气怎么样？" },
];

export default function App() {
  const { messages, running, health, sessions, activeId, send, stop, reset, switchSession, removeSession } =
    useAgentChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSwitch={switchSession}
        onDelete={removeSession}
        onNew={reset}
        onPickSuggestion={(t) => void send(t)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white lg:hidden">
              知
            </div>
            <div>
              <div className="text-sm font-semibold text-white">知行 Agent · AI 智能助手</div>
              <div className="text-[11px] text-slate-400">会规划 · 会查证 · 会使用工具</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[11px] font-medium " +
                  (health.mode === "ai"
                    ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border border-amber-500/40 bg-amber-500/10 text-amber-300")
                }
              >
                {health.mode === "ai" ? `已接入 ${health.model ?? "大模型"}` : "演示模式（未配置 Key）"}
              </span>
            )}
            {messages.length > 0 && (
              <button
                onClick={reset}
                className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
              >
                新对话
              </button>
            )}
          </div>
        </header>

        {/* 消息区 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 ? (
              <EmptyState onPick={(t) => void send(t)} />
            ) : (
              messages.map((m) => <MessageView key={m.id} message={m} />)
            )}
          </div>
        </div>

        {/* 输入区 */}
        <ChatInput running={running} onSend={(t, imgs) => void send(t, imgs)} onStop={stop} />
      </main>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center pt-10 text-center lg:pt-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-2xl font-bold text-white shadow-xl shadow-indigo-500/20">
        知
      </div>
      <h1 className="mt-5 bg-gradient-to-r from-indigo-300 via-slate-100 to-cyan-300 bg-clip-text text-2xl font-bold text-transparent lg:text-3xl">
        你好，我是知行 Agent
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
        我会把复杂问题拆解成执行计划，查证知识库后再回答，
        <br />
        全过程透明可见、结论有据可查。
      </p>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.text)}
            className="group rounded-xl border border-slate-700/70 bg-slate-800/40 px-4 py-3.5 text-left transition-all hover:border-indigo-400/60 hover:bg-slate-800"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <span>{s.icon}</span>
              {s.title}
              <span className="ml-auto text-slate-600 transition-colors group-hover:text-indigo-300">→</span>
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-400">{s.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
