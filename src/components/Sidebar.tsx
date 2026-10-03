import type { StoredSession } from "../hooks/useAgentChat";

interface SidebarProps {
  sessions: StoredSession[];
  activeId: string;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onPickSuggestion: (text: string) => void;
  /** 移动端抽屉开关 */
  open: boolean;
  onClose: () => void;
  /** 知识库条数（来自 /api/health，便于与后端保持一致） */
  knowledgeChunks?: number;
  /** 是否已配置视觉模型 */
  visionReady?: boolean;
  /** 可用知识域（来自 /api/health） */
  domains?: Array<{ id: string; name: string; description: string; chunks: number }>;
  /** 当前知识域 id */
  domain?: string;
  onDomainChange?: (id: string) => void;
}

const CAPABILITIES = [
  { icon: "🧠", title: "Agent 规划", desc: "复杂问题自动拆解为执行步骤，过程全程可见" },
  { icon: "📚", title: "RAG 混合检索", desc: "BM25 + 向量融合，回答标注引用来源" },
  { icon: "🛠️", title: "工具调用", desc: "计算 / 时间 / 实时天气 / 图片理解，JSON Schema 契约" },
  { icon: "📷", title: "多模态理解", desc: "图片进入 Agent 主循环，可与检索、工具协同" },
  { icon: "🔊", title: "语音交互", desc: "Web Speech API 语音输入与回答朗读，无第三方依赖" },
  { icon: "🛡️", title: "安全兜底", desc: "输入过滤、输出治理、优雅降级" },
];

const KB_TOPICS = [
  "报名时间与截止日期",
  "A/B/C 组报名规则",
  "评审标准与权重",
  "作品提交材料要求",
  "省赛/国赛奖项设置",
  "推荐技术栈",
];

export default function Sidebar({
  sessions,
  activeId,
  onSwitch,
  onDelete,
  onNew,
  onPickSuggestion,
  open,
  onClose,
  knowledgeChunks,
  visionReady,
  domains,
  domain,
  onDomainChange,
}: SidebarProps) {
  return (
    <>
      {/* 移动端遮罩 */}
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={
          "fixed inset-y-0 left-0 z-40 flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:bg-slate-900/60 " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-lg font-bold text-white shadow-lg shadow-indigo-500/20">
            知
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-white">知行 Agent</div>
            <div className="text-xs text-slate-400">知你所问 · 行你所托</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起侧栏"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-white lg:hidden"
          >
            ✕
          </button>
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

        {domains && domains.length > 0 && (
          <div className="border-t border-slate-800 px-4 py-4">
            <div className="mb-2 text-xs font-medium text-slate-300">
              知识域 <span className="text-slate-500">（同一套 Agent，切换语料即换场景）</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "all", name: "全部", chunks: knowledgeChunks ?? 0, description: "跨域检索" }, ...domains].map((d) => (
                <button
                  key={d.id}
                  onClick={() => onDomainChange?.(d.id)}
                  title={d.description}
                  className={
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors " +
                    (domain === d.id
                      ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                      : "border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-indigo-200")
                  }
                >
                  {d.name} · {d.chunks}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-800 px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            知识库合计{typeof knowledgeChunks === "number" ? ` · ${knowledgeChunks} 篇` : ""}
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
          <br />
          {visionReady ? "图片理解：已启用" : "图片理解：待配置 VISION_API_KEY"}
        </div>
      </aside>
    </>
  );
}
