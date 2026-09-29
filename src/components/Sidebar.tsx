import type { StoredSession } from "../hooks/useAgentChat";

interface SidebarProps {
  sessions: StoredSession[];
  activeId: string;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onPickSuggestion: (text: string) => void;
}

const CAPABILITIES = [
  { icon: "🧠", title: "Agent 规划", desc: "复杂问题自动拆解为执行步骤，过程全程可见" },
  { icon: "📚", title: "RAG 混合检索", desc: "BM25 + 向量融合，回答标注引用来源" },
  { icon: "🛠️", title: "工具调用", desc: "计算器、时间、天气等工具，MCP 风格注册表" },
  { icon: "📷", title: "图片理解", desc: "发送图片提问，多模态视觉模型解读" },
  { icon: "🛡️", title: "安全兜底", desc: "输入过滤、风险拦截、优雅降级" },
];

const KB_TOPICS = [
  "报名时间与截止日期",
  "A/B/C 组报名规则",
  "评审标准与权重",
  "作品提交材料要求",
  "省赛/国赛奖项设置",
  "推荐技术栈",
];

export default function Sidebar({ sessions, activeId, onSwitch, onDelete, onNew, onPickSuggestion }: SidebarProps) {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-lg font-bold text-white shadow-lg shadow-indigo-500/20">
          知
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">知行 Agent</div>
          <div className="text-xs text-slate-400">知你所问 · 行你所托</div>
        </div>
      </div>

      <div className="px-4">
        <button
          onClick={onNew}
          className="w-full rounded-lg bg-gradient-to-r from-indigo-500/80 to-cyan-500/80 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          ＋ 新对话
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={
              "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors " +
              (s.id === activeId
                ? "bg-slate-700/70 text-slate-100"
                : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200")
            }
            onClick={() => onSwitch(s.id)}
          >
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              aria-label="删除会话"
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] text-slate-500 transition-colors hover:bg-red-500/20 hover:text-red-300 group-hover:flex"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2.5 border-t border-slate-800 px-4 py-4">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="flex items-start gap-2.5 rounded-lg bg-slate-800/50 px-3 py-2.5">
            <span className="mt-0.5 text-base leading-none">{c.icon}</span>
            <div>
              <div className="text-[13px] font-medium text-slate-100">{c.title}</div>
              <div className="mt-0.5 text-xs leading-5 text-slate-400">{c.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800 px-4 py-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          传智杯备赛知识库 · 15 篇
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KB_TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => onPickSuggestion(`请介绍一下${t}？`)}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-indigo-400 hover:text-indigo-200"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pb-4 text-[11px] leading-5 text-slate-500">
        传智杯 · AI WEB 网页开发挑战赛 参赛作品
        <br />
        React 18 + Vite + Tailwind CSS
      </div>
    </aside>
  );
}
