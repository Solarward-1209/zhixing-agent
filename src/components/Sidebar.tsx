interface SidebarProps {
  onPickSuggestion: (text: string) => void;
}

const CAPABILITIES = [
  { icon: "🧠", title: "Agent 规划", desc: "复杂问题自动拆解为执行步骤，过程全程可见" },
  { icon: "📚", title: "RAG 查证", desc: "回答基于内置赛事知识库，标注引用来源" },
  { icon: "🛠️", title: "工具调用", desc: "计算器、时间、天气等工具，MCP 风格注册表" },
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

export default function Sidebar({ onPickSuggestion }: SidebarProps) {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-lg font-bold text-white shadow-lg shadow-indigo-500/20">
          知
        </div>
        <div>
          <div className="text-base font-semibold text-white">知行 Agent</div>
          <div className="text-xs text-slate-400">知你所问 · 行你所托</div>
        </div>
      </div>

      <div className="space-y-2.5 px-4 pb-4">
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

      <div className="mt-auto px-5 pb-4 text-[11px] leading-5 text-slate-500">
        传智杯 · AI WEB 网页开发挑战赛 参赛作品 v0.1
        <br />
        React 18 + Vite + Tailwind CSS
      </div>
    </aside>
  );
}
