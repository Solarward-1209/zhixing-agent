# 知行 Agent —— 会规划、会查证、会使用工具的 AI 智能助手

> 传智杯 · AI WEB 网页开发挑战赛 参赛作品 v0.2
> 赛道方向：**AI Agent 智能助手**（自主规划 · 工具调用 · 多轮对话 · RAG 查证 · 图片理解）
>
> [![CI](https://github.com/Solarward-1209/zhixing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Solarward-1209/zhixing-agent/actions/workflows/ci.yml)

「知行 Agent」是一个透明化的 AI Agent Web 应用：面对复杂问题时，它先**生成可见的执行计划**，再**检索知识库（RAG）查证**、**调用外部工具**求解，最后以**流式输出**给出带引用来源的回答——全过程在界面上实时可视化。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 🗺️ Agent 执行计划可视化 | 每个问题自动拆解为 2~5 步计划，步骤状态（待执行/执行中/完成）实时更新 |
| 📚 RAG 混合检索 | BM25（常驻）+ 向量检索（可插拔）融合，内置传智杯备赛知识库 15 篇，引用编号 + 来源卡片 |
| 🛠️ MCP 风格工具注册表 | 计算器（递归下降解析器，非 eval）、时间查询、天气查询（模拟数据），统一 JSON Schema 契约 |
| 📷 图片理解 | 独立视觉模型通道（GLM-4V），发送图片提问，未配置时优雅引导 |
| ⚡ 流式输出 | SSE 事件流推送 token，打字机效果流畅渲染 Markdown |
| 🧠 思考状态可视化 | 理解 → 规划 → 检索 → 调用工具 → 生成回答，每个阶段清晰呈现 |
| 💾 会话持久化 | localStorage 多会话管理，刷新/重启后自动恢复 |
| 🛡️ AI 安全与兜底 | 输入侧风险话题拦截、输出侧专业建议免责声明、异常优雅降级 |
| 🎭 双模式运行 | 未配置 API Key 时自动进入本地演示模式（真实执行检索与工具）；配置后无缝切换真实大模型 |

## 🏗️ 技术架构

```
┌───────────────────────────── 浏览器（React 18 + Vite + Tailwind CSS）────────────────────────────┐
│  App ─ useAgentChat(SSE 客户端 + 多会话) ─ MessageView(计划时间线/工具卡片/Markdown流式/来源引用)   │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │ POST /api/chat (SSE)   GET /api/health
┌──────────────────────────────────────────┴───────────────────────────────────────────────────┐
│  Agent 编排器 server/agent.ts：理解 → 规划(LLM) → 行动(RAG检索 + 工具循环≤3轮) → 生成(LLM流式)   │
│    ├── rag.ts      混合检索：BM25(k1=1.5,b=0.75，标题字段加权) + Embedder 适配器(0.45/0.55 融合) │
│    ├── tools.ts    工具注册表（calculate / get_current_time / get_weather），JSON Schema 契约    │
    ├── vision.ts   图片理解通道（GLM-4V，输入校验 + 未配置降级）                                    │
│    ├── llm.ts      OpenAI 兼容大模型客户端（智谱 GLM / DeepSeek，流式 + Function Calling）        │
│    ├── safety.ts   输入过滤 · 免责声明 · 兜底话术                                              │
│    └── demo.ts     演示模式：真实执行检索与工具，回答由知识库原文组织（不编造）                    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**事件协议**（`shared/protocol.ts`）：服务端通过 SSE 推送 `status / plan / step_update / tool_call / tool_result / token / sources / error / done` 九类事件，前端据此渲染 Agent 的完整执行过程——前后端职责单一，协议可独立演进。

## 🚀 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 开发模式（默认 http://localhost:5173）
npm test        # 38 项单元测试（离线运行）
npm run build   # 类型检查 + 生产构建
npm run server  # 独立生产服务器（托管 dist/ + /api，端口 8787）
```

### 接入真实大模型（可选）

复制 `.env.example` 为 `.env`，填入任一家兼容 OpenAI 协议的 API Key：

```bash
# DeepSeek（当前演示使用）
AI_PROVIDER=deepseek
AI_API_KEY=你的Key
# 或智谱 AI（GLM-4-Flash 有免费额度）
# AI_PROVIDER=zhipu
# AI_API_KEY=你的Key
```

可选增强能力：

```bash
# 图片理解（视觉模型，GLM-4V-Flash 有免费额度）
VISION_API_KEY=你的智谱APIKey
# 向量检索（配置后 RAG 自动升级为 BM25+向量混合模式）
EMBEDDING_API_KEY=你的智谱APIKey
```

保存后重启 `npm run dev`，顶栏徽标从「演示模式」变为「已接入模型」即生效。
未配置 Key 时应用不会报错，而是运行本地演示模式（RAG 检索与工具调用均为真实执行）。

> ⚠️ **密钥安全**：API Key 只保存在 `.env`（已被 .gitignore / .dockerignore 排除），绝不提交到仓库或打入镜像。

### 在线部署

见 [DEPLOY.md](DEPLOY.md)：Render（推荐）/ Railway / Docker / 裸机四条路线，含部署后自检清单。

## 📁 目录结构

```
zhixing-agent/
├── data/knowledge.json      # 传智杯备赛知识库（RAG 数据源）
├── server/                  # Agent 服务端（Node）
│   ├── agent.ts             # 编排器：理解→规划→行动→生成
│   ├── api.ts               # SSE 端点 + 健康检查
│   ├── main.ts              # 独立生产服务器（静态托管 + API）
│   ├── llm.ts               # OpenAI 兼容客户端（流式/Function Calling）
│   ├── rag.ts               # 混合检索（BM25 + 可插拔向量）
│   ├── tools.ts             # 工具注册表（MCP 风格契约）
│   ├── vision.ts            # 图片理解通道
│   ├── safety.ts            # 安全过滤与兜底
│   ├── demo.ts              # 演示模式流水线
│   └── env.ts               # .env 读取
├── shared/protocol.ts       # 前后端共享事件协议（九类事件）
├── src/                     # 前端（React 18 + Tailwind）
│   ├── App.tsx              # 布局与空状态
│   ├── hooks/useAgentChat.ts# SSE 客户端 + 多会话持久化
│   └── components/          # Sidebar / MessageView / ChatInput
├── tests/                   # Vitest 单元测试（38 项）
├── docs/                    # 技术文档 PDF · 演示视频脚本 · 生成脚本
├── .github/workflows/ci.yml # CI：typecheck + test + build
├── Dockerfile               # 生产镜像（密钥运行时注入）
├── DEPLOY.md                # 部署指南
└── .env.example             # 环境变量模板（密钥不入库）
```

## 📄 参赛材料

| 材料 | 位置 | 状态 |
|---|---|---|
| 代码仓库（本仓库） | 公开 + README + 完整 Git 历史 | ✅ |
| 技术文档（PDF，16 页） | [docs/知行Agent技术文档.pdf](docs/知行Agent技术文档.pdf) | ✅（团队信息页提交前填写） |
| 演示视频脚本（5-8 分钟） | [docs/演示视频脚本.md](docs/演示视频脚本.md) | ✅ 脚本就绪，按脚本录制 |
| 在线演示（加分项） | 部署指南见 DEPLOY.md | 🔧 部署后获得公网地址 |

## 🎯 与评审标准的对应（自评）

| 评分维度 | 权重 | 本作品落点 |
|---|---|---|
| AI技术深度 | 35% | LLM 集成（双提供商、Prompt 分档、流式稳定）、Agent 规划-行动主循环（实测自主多工具协同）、RAG 混合检索与引用溯源、图片理解、AI 安全四道防线、MCP 风格工具协议 |
| 创新性 | 25% | 「全过程透明可视化」Agent 交互范式、演示/真实双模式同构、工具结果驱动的生成式 UI（详见技术文档第 6 章） |
| 前端工程质量 | 10% | TypeScript 严格模式、组件化分层、共享事件协议、38 项测试 + CI 门禁 |
| 实用性 | 10% | 面向备赛学生的真实场景：赛事规则问答 + 日常工具，答案有据可查 |
| 用户体验 | 10% | 流式渲染、思考状态可视化、优雅错误兜底、响应式布局、多会话管理 |
| 社会价值与商业潜力 | 10% | 「有据可查的 AI 助手」范式可迁移至校园服务、企业客服等场景（技术文档 6.2 论证） |

## 👥 团队信息（提交前务必填写）

| 项目 | 内容 |
|---|---|
| 队伍名称 | ＿＿＿＿＿＿ |
| 成员及分工 | ＿＿＿＿＿＿ |
| 指导老师 | ＿＿＿＿＿＿ |
| 参赛组别 | B组 |

## 🗺️ 路线图

- [ ] 知识库升级为向量入库（pgvector/Milvus），支持文档上传与自动分块
- [ ] 接入真实 MCP Server，实现工具动态发现
- [ ] 端侧智能：Transformers.js / WebGPU 浏览器端小模型推理
- [ ] 语音交互：Web Speech API 语音输入与朗读
- [ ] 生成式 UI 增强：工具结果渲染为可交互图表（ECharts）
