# 知行 Agent —— 会规划、会查证、会使用工具的 AI 智能助手

> 传智杯 · AI WEB 网页开发挑战赛 参赛作品（初版 v0.1）
> 赛道方向：**AI Agent 智能助手**（自主规划 · 工具调用 · 多轮对话 · RAG 查证）

「知行 Agent」是一个透明化的 AI Agent Web 应用：面对复杂问题时，它先**生成可见的执行计划**，再**检索知识库（RAG）查证**、**调用外部工具**求解，最后以**流式输出**给出带引用来源的回答——全过程在界面上实时可视化。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 🗺️ Agent 执行计划可视化 | 每个问题自动拆解为 2~5 步计划，步骤状态（待执行/执行中/完成）实时更新 |
| 📚 RAG 有据回答 | 内置「传智杯备赛知识库」（15 篇，内容来自大赛官网），TF-IDF 检索 + 引用编号 + 来源卡片 |
| 🛠️ MCP 风格工具注册表 | 计算器（递归下降解析器，非 eval）、时间查询、天气查询（模拟数据），统一 JSON Schema 契约，易于扩展 |
| ⚡ 流式输出 | SSE 事件流推送 token，打字机效果流畅渲染 Markdown |
| 🧠 思考状态可视化 | 理解 → 规划 → 检索 → 调用工具 → 生成回答，每个阶段清晰呈现 |
| 🛡️ AI 安全与兜底 | 输入侧风险话题拦截、输出侧专业建议免责声明、异常优雅降级（不抛堆栈给用户） |
| 🎭 双模式运行 | 未配置 API Key 时自动进入本地演示模式（真实执行检索与工具）；配置后无缝切换真实大模型 |

## 🏗️ 技术架构

```
┌───────────────────────────── 浏览器（React 18 + Vite + Tailwind CSS）─────────────────────────────┐
│  App ─ useAgentChat(SSE 客户端) ─ MessageView(计划时间线/工具卡片/Markdown流式/来源引用) ─ Sidebar  │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │ POST /api/chat (SSE)   GET /api/health
┌──────────────────────────────────────────┴───────────────────────────────────────────────────┐
│  Agent 编排器 server/agent.ts：理解 → 规划(LLM) → 行动(RAG检索 + 工具循环) → 生成(LLM流式)      │
│    ├── rag.ts        TF-IDF 检索（中文 unigram+bigram 分词），知识库 data/knowledge.json        │
│    ├── tools.ts      工具注册表（calculate / get_current_time / get_weather），JSON Schema 契约  │
│    ├── llm.ts        OpenAI 兼容大模型客户端（智谱 GLM / DeepSeek，流式 + Function Calling）     │
│    ├── safety.ts     输入过滤 · 免责声明 · 兜底话术                                             │
│    └── demo.ts       演示模式：真实执行检索与工具，回答由知识库原文组织（不编造）                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**事件协议**（`shared/protocol.ts`）：服务端通过 SSE 推送 `status / plan / step_update / tool_call / tool_result / token / sources / error / done` 九类事件，前端据此渲染 Agent 的完整执行过程——前后端职责单一，协议可独立演进。

## 🚀 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 启动开发服务器（默认 http://localhost:5173）
```

打开浏览器访问 <http://localhost:5173>，点击示例问题即可体验。

### 接入真实大模型（可选）

复制 `.env.example` 为 `.env`，填入任一家兼容 OpenAI 协议的 API Key：

```bash
# 智谱 AI（GLM-4-Flash 有免费额度，推荐备赛起步）
AI_PROVIDER=zhipu
AI_API_KEY=你的Key
# 或 DeepSeek
# AI_PROVIDER=deepseek
# AI_API_KEY=你的Key
```

保存后重启 `npm run dev`，顶栏徽标从「演示模式」变为「已接入模型」即生效。
未配置 Key 时应用不会报错，而是运行本地演示模式（RAG 检索与工具调用均为真实执行）。

### 生产构建

```bash
npm run build   # 类型检查 + 产物构建（dist/）
npm run preview # 本地预览构建产物
```

> 注：初版为演示架构，`/api` 挂载在 Vite 开发服务器中间件上；生产部署时将 `server/` 平移到独立 Node 服务（Express/Hono）或迁移至 Next.js Route Handler 即可，业务代码无需改动。

## 🎯 与评审标准的对应（自评）

| 评分维度 | 权重 | 本作品落点 |
|---|---|---|
| AI技术深度 | 35% | LLM 集成（Prompt 设计 + 流式稳定输出）、Agent 规划-行动主循环、RAG 检索增强与引用、AI 安全兜底、MCP 风格工具协议 |
| 创新性 | 25% | 「全过程透明可视化」的 Agent 交互范式：计划时间线 + 工具卡片 + 引用溯源，区别于黑盒聊天框 |
| 前端工程质量 | 10% | TypeScript 严格模式、组件化分层、共享事件协议、SSE 断流兜底 |
| 实用性 | 10% | 面向备赛学生的真实场景：赛事规则问答 + 日常工具 |
| 用户体验 | 10% | 流式渲染、思考状态可视化、错误边界优雅、响应式布局 |
| 社会价值与商业潜力 | 10% | 「有据可查的 AI 助手」范式可迁移至校园服务、企业客服等场景 |

## 📁 目录结构

```
zhixing-agent/
├── data/knowledge.json      # 传智杯备赛知识库（RAG 数据源）
├── server/                  # Agent 服务端（Node）
│   ├── agent.ts             # 编排器：理解→规划→行动→生成
│   ├── api.ts               # SSE 端点 + 健康检查
│   ├── llm.ts               # OpenAI 兼容客户端（流式/Function Calling）
│   ├── rag.ts               # TF-IDF 检索
│   ├── tools.ts             # 工具注册表
│   ├── safety.ts            # 安全过滤与兜底
│   ├── demo.ts              # 演示模式流水线
│   └── env.ts               # .env 读取
├── shared/protocol.ts       # 前后端共享事件协议
├── src/                     # 前端（React 18 + Tailwind）
│   ├── App.tsx              # 布局与空状态
│   ├── hooks/useAgentChat.ts# SSE 客户端与会话状态
│   └── components/          # Sidebar / MessageView / ChatInput
├── .env.example             # 环境变量模板（密钥不入库）
└── vite.config.ts           # 含 /api 中间件插件
```

## 👥 团队信息（占位，提交前补全）

- 队名：____
- 成员：____（B组 · 非985/211普通本科院校本科生）
- 指导老师：____

## 🗺️ 路线图（初版 → 提交版）

- [ ] 知识库升级为向量检索（嵌入模型 + 余弦相似度），支持文档上传与分块
- [ ] 多模态：图片理解输入（GLM-4V / Qwen-VL）、语音输入（Web Speech API）
- [ ] MCP 协议接入真实 MCP Server（工具动态发现）
- [ ] 会话持久化（LocalStorage / IndexedDB）与多会话管理
- [ ] 生成式 UI：工具结果渲染为可交互图表（ECharts）
- [ ] 端侧推理探索：Transformers.js 浏览器端小模型
- [ ] 演示视频、技术文档（PDF ≤30 页）等提交材料
