# 知行 Agent —— 会规划、会查证、会使用工具的 AI 智能助手

> 传智杯 · AI WEB 网页开发挑战赛 参赛作品
> 赛道方向：**AI Agent 智能助手**（自主规划 · 工具调用 · MCP 动态工具 · 多知识域 RAG · 多模态 · 语音交互）
>
> [![CI](https://github.com/Solarward-1209/zhixing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Solarward-1209/zhixing-agent/actions/workflows/ci.yml)

「知行 Agent」是一个透明化的 AI Agent Web 应用：面对复杂问题时，它先**生成可见的执行计划**，再**检索知识库（RAG）查证**、**调用外部工具**求解，最后以**流式输出**给出带引用来源的回答——全过程在界面上实时可视化。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 🗺️ 执行计划与真实执行严格对应 | 每个问题拆解为 2~5 步计划；**每一步的状态由真实执行动作驱动**（发起检索 / 调用某个工具 → 点亮对应步骤），不做"假进度" |
| 📚 RAG 多知识域混合检索 | BM25（域内独立统计）+ 向量检索（可插拔）融合，内置**双知识域 46 篇**（赛事备赛 31 + 校园学习 15，可一键切换），引用编号 + 来源卡片；相关度以**词项覆盖率**如实展示，而非恒定的 1.00 |
| 🛠️ 工具注册表（JSON Schema 契约） | calculate 精确计算 / get_current_time 时间 / **get_weather 真实天气（Open-Meteo，免 Key）** / understand_image 图片理解 |
| 🔌 标准 MCP 集成 | 实现 MCP Streamable HTTP 的 initialize / tools/list / tools/call，远端工具**动态发现**并注册进同一张工具表；未配置或不可达时静默降级 |
| 🌐 多知识域（场景可迁移） | 同一套 Agent 挂载不同语料即换场景：赛事备赛 ⇄ 校园学习；新增场景只需一个 JSON + 一条登记 |
| 🔊 语音交互 | Web Speech API 语音输入与回答朗读，无第三方依赖，浏览器不支持时优雅降级 |
| 📷 多模态融入主循环 | 图片不再走旁路：uploaded 图片由 Agent **自主调用 understand_image 工具**，其结果与 RAG、其它工具一起进入最终回答 |
| ⚡ 流式输出 | SSE 事件流推送 token，按帧批处理渲染，打字机效果流畅 |
| 🧠 思考状态可视化 | 理解 → 规划 → 检索 → 调用工具 → 生成回答，阶段文案与真实阶段一致 |
| 💾 会话持久化 | localStorage 多会话管理，刷新/重启后自动恢复 |
| 🔁 对话操作 | 复制回答 / 重新生成 / 👍👎 反馈（随会话持久化） |
| 🛡️ AI 安全与治理 | 输入侧归一化风险拦截（抗空格/符号/全角变形）、输出侧密钥遮蔽与高风险标记、专业建议免责声明、异常优雅降级 |
| 🧱 稳定性 | LLM 请求 30s 超时 + 429/5xx 指数退避重试 + 可选降级模型；用户点「停止」会真正取消上游请求 |
| 🎭 双模式运行 | 未配置 API Key 时自动进入本地演示模式（检索与工具真实执行）；配置后无缝切换真实大模型 |

## 🏗️ 技术架构

```
┌──────────────────────── 浏览器（React 18 + Vite + Tailwind CSS）────────────────────────┐
│  App ─ useAgentChat(SSE 客户端 + 按帧节流 + 多会话) ─ MessageView(计划时间线/工具卡片/   │
│         Markdown 流式/来源引用/复制·重生成·朗读·反馈)                                   │
│      └ useSpeech(Web Speech API 语音输入 / TTS)                                          │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ POST /api/chat (SSE)   GET /api/health
┌──────────────────────────────────────────┴──────────────────────────────────────────────┐
│  Agent 编排器 server/agent.ts                                                            │
│    理解 → 规划(LLM) → 行动(图片理解 / RAG 检索 / 工具循环≤3轮) → 生成(LLM 流式 + 输出治理) │
│    ├── llm.ts       OpenAI 兼容客户端（超时 30s · 指数退避重试 · 备用模型 · AbortSignal） │
│    ├── rag.ts       混合检索：BM25(k1=1.5,b=0.75，标题加权) + Embedder 适配器(0.45/0.55)  │
│    ├── tools.ts     工具注册表（calculate / time / weather / understand_image + MCP）     │
│    ├── mcp.ts       标准 MCP 客户端（initialize / tools/list / tools/call，动态工具发现）  │
│    ├── vision.ts    图片理解（GLM-4V，可被工具调用；区分"未配置"与"调用失败"）            │
│    ├── safety.ts    输入归一化拦截 · 输出密钥遮蔽 · 免责声明 · 兜底话术                    │
│    ├── api.ts       请求体上限 · IP 限流 · history 校验 · 断连取消上游请求                 │
│    ├── main.ts      生产服务器（静态托管 + gzip + SPA 回退）                              │
│    └── demo.ts      演示模式：真实执行检索与工具，回答由知识库原文组织（不编造）           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**事件协议**（`shared/protocol.ts`）：服务端通过 SSE 推送 `status / plan / step_update / tool_call / tool_result / token / sources / error / done` 九类事件，前端据此渲染 Agent 的完整执行过程——前后端职责单一，协议可独立演进。

## 🚀 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 开发模式（默认 http://localhost:5173）
npm test        # 66 项单元测试
npm run lint    # ESLint（CI 门禁之一）
npm run build   # 类型检查 + 生产构建（react / markdown 独立分包）
npm run server  # 独立生产服务器（托管 dist/ + /api，端口 8787，自带 gzip）
```

### 环境变量

复制 `.env.example` 为 `.env` 后按需填写（未配置 `AI_API_KEY` 时自动进入演示模式）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `AI_PROVIDER` | 否 | `zhipu`（默认）/ `deepseek` / 自定义 |
| `AI_API_KEY` | 是（真实模式） | 大模型 API Key |
| `AI_MODEL` / `AI_BASE_URL` | 否 | 覆盖默认模型与网关 |
| `AI_FALLBACK_MODEL` | 否 | 主模型失败后的降级模型 |
| `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | 否 | 请求超时（默认 30000）与重试次数（默认 2） |
| `VISION_API_KEY` / `VISION_MODEL` | 否 | 图片理解（GLM-4V-Flash 有免费额度） |
| `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | 否 | 配置后 RAG 自动升级为 BM25 + 向量混合检索 |
| `WEATHER_MODE` | 否 | `auto`（默认，真实数据源 Open-Meteo）/ `real` / `mock` |
| `MCP_SERVERS` / `MCP_SERVER_URL` | 否 | 声明标准 MCP Server（JSON 数组或单个 URL），工具会被动态发现 |
| `PORT` / `MAX_BODY_BYTES` / `RATE_LIMIT_MAX` | 否 | 端口、请求体上限、限流阈值 |

> ⚠️ **密钥安全**：API Key 只保存在 `.env`（已被 .gitignore / .dockerignore 排除），绝不提交到仓库或打入镜像；平台部署请使用平台的环境变量注入（运行时环境变量优先级高于 `.env`）。

### 在线部署

见 [DEPLOY.md](DEPLOY.md)：Render（推荐）/ Railway / Docker / 裸机四条路线，含部署后自检清单。

## 📁 目录结构

```
zhixing-agent/
├── data/knowledge.json      # 赛事备赛知识域（31 篇）
├── data/knowledge-campus.json # 校园学习知识域（15 篇，演示"换语料即换场景"）
├── server/                  # Agent 服务端（Node）
│   ├── agent.ts             # 编排器：理解→规划→行动→生成（计划/执行严格映射）
│   ├── api.ts               # SSE 端点 + 健康检查 + 限流/体积/校验
│   ├── main.ts              # 独立生产服务器（静态托管 + gzip + API）
│   ├── llm.ts               # OpenAI 兼容客户端（超时/重试/降级/取消）
│   ├── rag.ts               # 混合检索（BM25 + 可插拔向量 + 覆盖率相关度）
│   ├── tools.ts             # 工具注册表（计算/时间/真实天气/图片理解 + MCP 动态工具）
│   ├── mcp.ts               # 标准 MCP 客户端（动态工具发现与调用）
│   ├── vision.ts            # 图片理解通道
│   ├── safety.ts            # 输入过滤 · 输出治理 · 免责声明
│   ├── demo.ts              # 演示模式流水线
│   └── env.ts               # .env 读取
├── shared/protocol.ts       # 前后端共享事件协议（九类事件）
├── src/                     # 前端（React 18 + Tailwind）
│   ├── App.tsx              # 布局、空状态、移动端抽屉
│   ├── hooks/useAgentChat.ts# SSE 客户端 + 按帧节流 + 多会话持久化 + 重生成/反馈
│   ├── components/          # Sidebar / MessageView / ChatInput
│   ├── utils/image.ts       # 图片压缩与 HEIC 转码
│   └── hooks/useSpeech.ts   # 语音输入与朗读（Web Speech API）
├── tests/                   # Vitest 单元测试（66 项）
├── docs/                    # 技术文档 DOCX/PDF（23 页）· 演示视频脚本 · 生成脚本
├── eslint.config.js         # ESLint 9 扁平配置
├── .prettierrc.json         # Prettier 配置
├── .github/workflows/ci.yml # CI：lint + typecheck + test + build
├── .github/workflows/healthcheck.yml # 在线演示每 10 分钟探活（保活 + 异常留痕）
├── Dockerfile               # 生产镜像（密钥运行时注入）
├── DEPLOY.md                # 部署指南
└── .env.example             # 环境变量模板（含全部可配置项）
```

## 📄 参赛材料

| 材料 | 位置 | 状态 |
|---|---|---|
| 代码仓库（本仓库） | 公开 + README + 完整 Git 历史 | ✅ |
| 技术文档（PDF，23 页） | [docs/知行Agent技术文档.pdf](docs/知行Agent技术文档.pdf)（源文件 [DOCX](docs/知行Agent技术文档.docx)） | ✅（团队信息页 9.3 提交前填写） |
| 演示视频脚本（5-8 分钟） | [docs/演示视频脚本.md](docs/演示视频脚本.md) | ✅ 脚本就绪，按脚本录制 |
| 在线演示（加分项） | **https://zhixing-agent-production.up.railway.app** | ✅ 已上线（Railway 托管；健康检查/问答/引用/真实天气/多模态已实测；由 healthcheck 工作流保活） |

## 🌍 社会价值与商业潜力

### 社会价值

- **教育公平**：备赛资源长期集中在少数信息灵通的学生手里。知行 Agent 把散落在官网公告、赛道详情、政策文件中的规则与时间节点整理为可检索知识库，让任何一所学校的学生都能得到"有据可查"的备赛咨询，降低信息差。
- **可信 AI 的示范**：通用大模型最受诟病的就是"一本正经地编造"。本作品把**执行过程与结论依据同时可视化**（计划 → 检索 → 工具 → 引用），为"可信、可解释的人机协作"提供了一个可复制的交互范式。
- **可迁移的公共服务载体**：同一套"规划 + 检索 + 工具 + 引用 + 安全兜底"架构，可直接迁移至校园教务问答、企业知识管理、政务办事指引等场景——这些场景的共同痛点是"答案必须能溯源"，而不是"答案必须像人"。

### 商业潜力

| 维度 | 分析 |
|---|---|
| 目标用户 | ① 备赛/备考学生（C 端付费意愿低、规模大，适合做流量与口碑）；② 高校教务与就业指导中心（B 端，预算稳定）；③ 教育机构与企业培训部门（B 端，客单价高） |
| 商业模式 | **B 端订阅为主**：按席位/年费的 SaaS 订阅（知识库接入 + 私有化部署）；**C 端增值为辅**：免费版（单赛事知识库 + 基础工具），会员版（多赛事/多考试知识库、导出、语音）。B 端私有化部署一次性授权 + 年度运维 |
| 市场空间 | 以"高校在校生 AI 学习助手"为切入口：全国高校 3000+ 所，若按每校 B 端年平均 3–5 万元计，仅高校市场即 1–1.5 亿元/年量级；叠加企业培训与考试培训市场，空间更大 |
| 竞争差异 | 与 Kimi / 文心一言 / 通义千问等通用助手相比，本作品不拼"模型能力"，而拼 **① 垂直场景的权威知识库 ② 过程可视化与引用溯源 ③ 可私有化部署的数据边界**，这三项正是 B 端采购的决策点 |
| 成本结构 | 推理成本随用量线性增长，因此采用"小模型 + 强检索"降低 token 消耗（RAG 优先、工具替代心算、按帧节流），并将知识库检索做成可本地化（BM25 常驻，向量可选）以压低边际成本 |
| 可持续性 | 知识库可沉淀为数据资产，随赛事/考试周期持续更新形成订阅粘性；双模式设计保证在无外网 Key 的离线/内网环境中同样可用（私有化部署的必要条件） |

> 说明：以上为基于公开数据的量级估算，用于说明商业模式可行性，不代表收入承诺。

## 🎯 与评审标准的对应（自评）

| 评分维度 | 权重 | 本作品落点 |
|---|---|---|
| AI技术深度 | 35% | LLM 集成（超时/重试/降级、Prompt 分档与语言约束、Function Calling）；Agent 规划-行动主循环（**计划与执行严格映射**、工具结果回填、图片理解作为工具参与协同）；RAG **多知识域**混合检索与引用溯源（覆盖率可解释）；多模态（图片进入主循环）；AI 安全（输入归一化拦截 + 输出密钥遮蔽 + 免责声明 + 限流 + 兜底）；工具集成（4 个内置工具 + **标准 MCP 动态工具发现**） |
| 创新性 | 25% | 「全过程透明可视化」Agent 交互范式、演示/真实双模式同构、工具结果驱动的生成式 UI |
| 前端工程质量 | 10% | TypeScript 严格模式、组件化分层、共享事件协议、按帧节流渲染、代码分割、66 项测试 + ESLint + CI 门禁 |
| 实用性 | 10% | 面向学生的真实场景：赛事备赛 + 校园学习双知识域 + 真实天气/精确计算；答案有据可查、失败如实告知 |
| 用户体验 | 10% | 流式渲染、思考状态可视化、复制/重生成/朗读/反馈、移动端抽屉、优雅错误兜底、多会话管理 |
| 社会价值与商业潜力 | 10% | 见上节「社会价值与商业潜力」 |

## 👥 团队信息（提交前务必填写）

| 项目 | 内容 |
|---|---|
| 队伍名称 | ＿＿＿＿＿＿（待填写） |
| 成员及分工 | ＿＿＿＿＿＿（待填写） |
| 指导老师 | ＿＿＿＿＿＿（待填写） |
| 参赛组别 | B组 |

> 📌 **提交前检查清单**：① 上表填写完整；② 技术文档封面与演示视频开场口播同步填写；③ `/api/health` 返回 `mode: "ai"`；④ 线上演示地址可访问；⑤ 仓库中不含任何 `.env` 或密钥。

## 🗺️ 路线图

- [ ] 知识库升级为向量入库（pgvector/Milvus），支持文档上传与自动分块
- [x] 接入标准 MCP Server（initialize / tools/list / tools/call，动态工具发现）
- [x] 语音交互：Web Speech API 语音输入与朗读
- [x] 多知识域：同一套 Agent 挂载不同语料即换场景
- [ ] 端侧智能：Transformers.js / WebGPU 浏览器端小模型推理
- [ ] 生成式 UI 增强：工具结果渲染为可交互图表（ECharts）
- [ ] Multi-Agent 编排：Planner / Executor / Reviewer 三角色协作
