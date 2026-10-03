import { useEffect, useRef, useState } from "react";
import { useAgentChat } from "./hooks/useAgentChat";
import Sidebar from "./components/Sidebar";
import ChatInput from "./components/ChatInput";
import MessageView from "./components/MessageView";

/**
 * 空状态示例问题：刻意覆盖四种不同的 Agent 行为路径，
 * 让评委/用户第一次点击就能看到"检索、计算、时间、天气"四类证据形态，
 * 而不是把四个示例都做成同一种知识库问答。
 */
const SUGGESTIONS = [
  { icon: "🏆", title: "赛事咨询", text: "传智杯的报名截止时间是什么时候？评审标准是怎样的？" },
  { icon: "🧮", title: "精确计算", text: "帮我算一下 (128*46+372)/4 等于多少" },
  { icon: "⏰", title: "日期时间", text: "今天几号？现在离作品提交截止还有多久？" },
  { icon: "🌤️", title: "工具调用", text: "北京今天天气怎么样？" },
];

/**
 * 应用外壳：负责三件事——布局、移动端抽屉、把 hook 的能力分发给子组件。
 * 业务逻辑（SSE、会话、重生成）全部在 useAgentChat 内，这里保持"薄壳"，
 * 便于后续把布局换成路由或多面板而不牵动数据层。
 */
export default function App() {
  const {
    messages,
    running,
    health,
    sessions,
    activeId,
    domain,
    setDomain,
    send,
    stop,
    reset,
    regenerate,
    rate,
    switchSession,
    removeSession,
  } = useAgentChat();
  // 移动端抽屉开关：桌面端侧栏常驻，这个状态只影响 <lg 的断点
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 新消息/流式 token 到达时贴底。这里用直接赋值而不是 smooth 滚动：
    // 流式阶段每帧都会触发，平滑动画会互相打断并造成抖动。
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** 统一入口：发送前先收起移动端抽屉，避免答案被抽屉遮挡 */
  const handleSend = (text: string, images?: string[]) => {
    setDrawerOpen(false);
    void send(text, images);
  };

  return (
    <div className="flex h-full">
      <Sidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessions={sessions}
        activeId={activeId}
        onSwitch={(id) => {
          switchSession(id);
          setDrawerOpen(false);
        }}
        onDelete={removeSession}
        onNew={() => {
          reset();
          setDrawerOpen(false);
        }}
        onPickSuggestion={(t) => handleSend(t)}
        knowledgeChunks={health?.knowledgeChunks}
        visionReady={health?.vision === true}
        domains={health?.domains}
        domain={domain}
        onDomainChange={setDomain}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="打开会话列表"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:border-slate-500 hover:text-white lg:hidden"
            >
              ☰
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white lg:hidden">
              知
            </div>
            <div>
              <div className="text-sm font-semibold text-white">知行 Agent · AI 智能助手</div>
              <div className="text-[11px] text-slate-400">
                会规划 · 会查证 · 会使用工具
                {health?.domains && health.domains.length > 0 && (
                  <span className="ml-2 text-slate-500">
                    当前知识域：{domain === "all" ? "全部" : (health.domains.find((d) => d.id === domain)?.name ?? domain)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <>
                {/* 图片理解可用性：让用户（与评委）一眼看出多模态是否真的启用，而不是点了才发现没配 Key */}
                <span
                  className={
                    "hidden rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline " +
                    (health.vision
                      ? "border border-violet-500/40 bg-violet-500/10 text-violet-300"
                      : "border border-slate-700 bg-slate-800/60 text-slate-400")
                  }
                  title={health.vision ? "图片理解已启用" : "未配置 VISION_API_KEY，图片理解不可用"}
                >
                  {health.vision ? "📷 图片理解已启用" : "📷 图片理解未配置"}
                </span>
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
              </>
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
              <EmptyState onPick={handleSend} />
            ) : (
              messages.map((m) => (
                <MessageView key={m.id} message={m} onRegenerate={regenerate} onFeedback={rate} />
              ))
            )}
          </div>
        </div>

        {/* 输入区 */}
        <ChatInput running={running} onSend={handleSend} onStop={stop} visionReady={health?.vision} />
      </main>
    </div>
  );
}

/** 空状态：承担"能力说明 + 上手引导"两个职责，降低首次使用门槛 */
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
