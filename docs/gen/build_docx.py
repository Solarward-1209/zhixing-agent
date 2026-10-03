#!/usr/bin/env python3
"""知行 Agent 技术文档生成器（python-docx -> LibreOffice 渲染 PDF）。

与旧版 reportlab 流水线（gen_techdoc.py）相比：
- 不依赖额外 pip 包，使用运行环境自带的 python-docx；
- 内容随代码同步（多知识域 / MCP / 语音 / 真实天气 / 计划-执行严格映射 / 46 篇知识库 / 66 项测试）；
- 新增第 7 章「社会价值与商业潜力」（对应评审维度 10%）。

用法：
    python build_docx.py            # 生成 知行Agent技术文档.docx
然后用 LibreOffice Kit 转换：
    node <cli> convert --input 知行Agent技术文档.docx --output 知行Agent技术文档.pdf
"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT_DOCX = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "知行Agent技术文档.docx"))

EA_BODY = "宋体"
EA_HEAD = "微软雅黑"
LATIN = "Times New Roman"
LATIN_HEAD = "Segoe UI"
ACCENT = RGBColor(0x1F, 0x3A, 0x5F)
ACCENT2 = RGBColor(0x2E, 0x5A, 0x88)
MUTED = RGBColor(0x5A, 0x66, 0x70)
HEADER_FILL = "495F6A"
STRIPE_FILL = "F3F4F5"
CALLOUT_FILL = "EDF2F7"


def set_run(run, size=10.5, bold=False, color=None, ea=EA_BODY, latin=LATIN, italic=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = latin
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), ea)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)


def add_para(doc, text, size=10.5, space_after=6, indent=0.0, align=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(0)
    pf.line_spacing = 1.45
    if indent:
        pf.left_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    for idx, chunk in enumerate(text.split("**")):
        if not chunk:
            continue
        run = p.add_run(chunk)
        set_run(run, size=size, bold=(idx % 2 == 1))
    return p


def add_bullets(doc, items, size=10.5, indent=0.6):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        pf = p.paragraph_format
        pf.space_after = Pt(3)
        pf.line_spacing = 1.4
        pf.left_indent = Cm(indent)
        for idx, chunk in enumerate(item.split("**")):
            if not chunk:
                continue
            run = p.add_run(chunk)
            set_run(run, size=size, bold=(idx % 2 == 1))
    return None


def add_heading(doc, text, level=1):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    if level == 1:
        pf.space_before = Pt(16)
        pf.space_after = Pt(8)
        size, color, ea, latin = 17, ACCENT, EA_HEAD, LATIN_HEAD
    elif level == 2:
        pf.space_before = Pt(11)
        pf.space_after = Pt(5)
        size, color, ea, latin = 13.5, ACCENT2, EA_HEAD, LATIN_HEAD
    else:
        pf.space_before = Pt(8)
        pf.space_after = Pt(4)
        size, color, ea, latin = 11.5, ACCENT2, EA_HEAD, LATIN_HEAD
    run = p.add_run(text)
    set_run(run, size=size, bold=True, color=color, ea=ea, latin=latin)
    if level == 1:
        pPr = p._element.get_or_add_pPr()
        borders = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "10")
        bottom.set(qn("w:space"), "3")
        bottom.set(qn("w:color"), "C7D2DE")
        borders.append(bottom)
        pPr.append(borders)
    return p


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def add_table(doc, headers, rows, widths=None, size=9.5):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0]
    for i, text in enumerate(headers):
        cell = hdr.cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(text)
        set_run(run, size=size, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), ea=EA_HEAD, latin=LATIN_HEAD)
        shade(cell, HEADER_FILL)
    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        for i, text in enumerate(row):
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.3
            for k, chunk in enumerate(str(text).split("**")):
                if not chunk:
                    continue
                run = p.add_run(chunk)
                set_run(run, size=size, bold=(k % 2 == 1))
            if r_idx % 2 == 1:
                shade(cell, STRIPE_FILL)
    if widths:
        for row in table.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    return table


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(10)
    run = p.add_run(text)
    set_run(run, size=8.5, color=MUTED)


def add_callout(doc, text):
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    cell = table.rows[0].cells[0]
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    for idx, chunk in enumerate(text.split("**")):
        if not chunk:
            continue
        run = p.add_run(chunk)
        set_run(run, size=9.5, bold=(idx % 2 == 1))
    shade(cell, CALLOUT_FILL)
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(2)


def add_code(doc, lines):
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    cell = table.rows[0].cells[0]
    cell.text = ""
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.15
        run = p.add_run(line)
        set_run(run, size=8.5, ea="Consolas", latin="Consolas")
    shade(cell, "F6F8FA")
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(2)


def add_page_number_footer(section):
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run("知行 Agent 技术文档  ·  第 ")
    set_run(run, size=8, color=MUTED)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    fld.append(r)
    p._p.append(fld)
    run2 = p.add_run(" 页")
    set_run(run2, size=8, color=MUTED)


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def build():
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(2.3)
    section.right_margin = Cm(2.3)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)

    normal = doc.styles["Normal"]
    normal.font.name = LATIN
    normal.font.size = Pt(10.5)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), EA_BODY)
    normal.paragraph_format.line_spacing = 1.45

    add_page_number_footer(section)

    # ── 封面 ──
    band = doc.add_table(rows=1, cols=1)
    band_cell = band.rows[0].cells[0]
    band_cell.text = ""
    bp = band_cell.paragraphs[0]
    bp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    br = bp.add_run("传智杯 · AI WEB 网页开发挑战赛 · 技术文档")
    set_run(br, size=11, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), ea=EA_HEAD, latin=LATIN_HEAD)
    shade(band_cell, "1F3A5F")

    for _ in range(3):
        doc.add_paragraph()

    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = t.add_run("知行 Agent")
    set_run(tr, size=40, bold=True, color=ACCENT, ea=EA_HEAD, latin=LATIN_HEAD)

    st = doc.add_paragraph()
    st.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = st.add_run("会规划 · 会查证 · 会使用工具 · 会读图的透明化 AI 智能助手")
    set_run(sr, size=12, color=ACCENT2, ea=EA_HEAD, latin=LATIN_HEAD)

    for _ in range(2):
        doc.add_paragraph()

    add_table(
        doc,
        ["条目", "内容"],
        [
            ["赛道方向", "AI Agent 智能助手（2026 第九届传智杯全国大学生数智创新与 AI 应用大赛）"],
            ["参赛组别", "B 组"],
            ["作品形态", "Web 应用（React 18 + Vite 前端 / Node Agent 服务端），已提供公网在线演示"],
            ["技术关键词", "LLM · AI Agent · Function Calling · MCP · RAG · 多模态 · SSE 流式 · Web Speech"],
            ["知识库规模", "46 篇（赛事备赛 31 篇 + 校园学习 15 篇，双知识域可切换）"],
            ["代码与测试", "约 4800 行 TypeScript，66 项单元测试，ESLint / 类型检查 / 构建全量 CI 门禁"],
            ["代码仓库", "https://github.com/Solarward-1209/zhixing-agent"],
            ["文档日期", "2026 年 10 月"],
        ],
        widths=[3.4, 12.6],
    )

    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    add_para(
        doc,
        "团队信息（队伍名称、成员分工、指导老师）见本文档 9.3 节，提交前请核对填写。",
        size=9,
        align=WD_ALIGN_PARAGRAPH.CENTER,
    )

    page_break(doc)

    # ── 目录 ──
    add_heading(doc, "目录", 1)
    toc = [
        ("1 项目概述", 0), ("1.1 项目背景与选题方向", 1), ("1.2 产品定位与核心价值", 1),
        ("1.3 主要特性总览", 1), ("1.4 开发与运行环境", 1),
        ("2 需求分析", 0), ("2.1 目标用户与使用场景", 1), ("2.2 功能需求", 1), ("2.3 非功能需求", 1),
        ("3 系统架构设计", 0), ("3.1 总体架构", 1), ("3.2 事件协议设计", 1), ("3.3 模块划分", 1),
        ("3.4 关键设计决策", 1),
        ("4 AI 技术方案", 0), ("4.1 大模型集成质量（8%）", 1), ("4.2 Agent 规划与行动循环（8%）", 1),
        ("4.3 RAG 多知识域混合检索（6%）", 1), ("4.4 多模态图片理解（5%）", 1),
        ("4.5 AI 安全与可控性（4%）", 1), ("4.6 MCP 与工具集成（4%）", 1),
        ("5 核心功能实现", 0), ("5.1 执行计划可视化", 1), ("5.2 流式输出与思考状态可视化", 1),
        ("5.3 工具卡片与来源引用", 1), ("5.4 多知识域与场景迁移", 1), ("5.5 语音交互", 1),
        ("5.6 会话持久化与对话操作", 1), ("5.7 演示模式设计", 1),
        ("6 创新点说明", 0), ("6.1 技术创新点", 1), ("6.2 应用创新点", 1),
        ("7 社会价值与商业潜力", 0), ("7.1 社会价值", 1), ("7.2 目标用户与使用场景", 1),
        ("7.3 商业模式与定价", 1), ("7.4 市场空间估算", 1), ("7.5 竞争格局与差异化", 1),
        ("7.6 成本结构与可持续性", 1), ("7.7 风险与应对", 1),
        ("8 测试与部署", 0), ("8.1 测试策略与用例", 1), ("8.2 构建与运行", 1),
        ("8.3 部署方案", 1), ("8.4 评审期服务保障", 1),
        ("9 总结与展望", 0), ("9.1 当前成果", 1), ("9.2 路线图", 1), ("9.3 团队信息", 1),
    ]
    for text, level in toc:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.left_indent = Cm(0.6 if level else 0.0)
        run = p.add_run(text)
        set_run(run, size=10 if level == 0 else 9.5, bold=(level == 0), color=None if level else ACCENT)

    page_break(doc)

    # ══════════ 1 项目概述 ══════════
    add_heading(doc, "1 项目概述", 1)
    add_heading(doc, "1.1 项目背景与选题方向", 2)
    add_para(
        doc,
        "2026 年被业界称为「AI Agent 元年」：大模型的能力边界从生成文本扩展到自主规划与调用工具。"
        "与之同时，通用对话产品的信任问题愈发突出——模型会用非常自信的语气给出并不存在的规则、时间与数字，"
        "而用户无从判断答案的依据。在教育与知识服务场景中，这种幻觉是致命的："
        "一条错误的报名截止时间可能直接导致学生错过比赛。",
    )
    add_para(
        doc,
        "本作品选择大赛推荐方向中的 **AI Agent 智能助手**，但不把它做成又一个聊天框，"
        "而是回答一个更具体的问题：**如何让 AI 的回答变得可核查、可追溯、可解释？** "
        "因此我们把「执行过程透明化」作为产品核心，并把「有据可查」作为可信度基线。",
    )

    add_heading(doc, "1.2 产品定位与核心价值", 2)
    add_para(
        doc,
        "知行 Agent 是一个透明化的 AI Agent Web 应用。面对复杂问题时，它会先给出**可见的执行计划**，"
        "再按计划**检索知识库、调用外部工具**，最后以**流式输出**给出带引用编号的回答；"
        "计划、检索、工具调用、引用来源全部在界面上实时呈现。",
    )
    add_para(doc, "三条核心价值主张：")
    add_bullets(doc, [
        "**过程可信**：计划时间线由真实执行动作驱动，用户看到的每一步都确实发生过，不是装饰性动画。",
        "**结论可查**：知识库检索结果以编号引用标注在句末，来源卡片可悬停查看原文摘要。",
        "**能力可迁移**：同一套 Agent 架构挂载不同语料即可切换场景（赛事备赛 / 校园学习），"
        "工程上以多知识域落地，而不是写死在单一业务里。",
    ])

    add_heading(doc, "1.3 主要特性总览", 2)
    add_table(
        doc,
        ["能力", "实现要点", "对应评分点"],
        [
            ["执行计划与真实执行严格对应", "PlanTracker 按关键词把计划步骤与真实动作（检索 / 某次工具调用）绑定，匹配不到就不发进度事件", "Agent/工作流设计（8%）"],
            ["RAG 多知识域混合检索", "BM25（域内独立统计）+ 可插拔向量检索（0.45/0.55 融合），词项覆盖率解释相关度，双知识域 46 篇", "RAG 技术应用（6%）"],
            ["工具与 MCP 集成", "内置计算/时间/真实天气/图片理解 4 个工具；标准 MCP 客户端支持 tools/list 动态发现远端工具", "MCP/工具集成（4%）"],
            ["多模态融入主循环", "图片由 Agent 自主调用 understand_image 工具，结果与检索结果共同参与生成", "多模态能力（5%）"],
            ["AI 安全与可信", "输入归一化拦截、输出密钥遮蔽与高风险标记、专业建议免责声明、限流与体积上限", "AI 安全与可控性（4%）"],
            ["流式与状态可视化", "九类 SSE 事件；token 按帧批处理渲染；六阶段状态文案与真实阶段一致", "AI 交互体验（3%）"],
            ["对话操作与语音", "复制 / 重新生成 / 点赞点踩反馈持久化；Web Speech API 语音输入与回答朗读", "前端交互体验（3%）"],
            ["工程与质量", "TypeScript 严格模式、ESLint、66 项单元测试、CI 门禁、代码分割与 gzip", "前端工程质量（10%）"],
        ],
        widths=[4.0, 9.0, 3.4],
    )
    add_caption(doc, "表 1-1 主要特性与评分点对应关系")

    add_heading(doc, "1.4 开发与运行环境", 2)
    add_table(
        doc,
        ["类别", "选型", "说明"],
        [
            ["前端", "React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3", "单页应用，构建产物分包（react / markdown 独立 chunk）"],
            ["服务端", "Node.js 20+ / tsx", "同一套 TypeScript 代码，开发态挂 Vite 中间件，生产态独立进程"],
            ["大模型", "OpenAI 兼容协议（DeepSeek / 智谱 GLM）", "流式 + Function Calling，可配置降级模型"],
            ["检索", "自研 BM25 + 可插拔 Embedding 适配器", "无外部依赖即可运行；配置 Key 后自动升级混合检索"],
            ["质量", "Vitest 2 + ESLint 9 + tsc --noEmit + GitHub Actions", "lint / typecheck / test / build 全量门禁"],
            ["部署", "Railway（在线演示）+ Docker / Render 备选", "密钥通过平台环境变量注入"],
        ],
        widths=[2.6, 6.6, 6.8],
    )

    page_break(doc)

    # ══════════ 2 需求分析 ══════════
    add_heading(doc, "2 需求分析", 1)
    add_heading(doc, "2.1 目标用户与使用场景", 2)
    add_para(
        doc,
        "**核心用户**：参加学科竞赛、备考升学、需要频繁查询规章制度的高校学生。他们的共同特征是："
        "问题答案有权威来源（官网公告、培养方案、政策文件），但信息分散、检索成本高，"
        "并且**不能接受错误答案**。",
    )
    add_para(doc, "典型场景：")
    add_bullets(doc, [
        "备赛咨询：报名时间、组别规则、评审标准、提交材料、奖项设置——答案必须能追溯到官方原文。",
        "学业事务：选课退课、绩点计算、保研推免、四六级与考研时间线——需要把哪一步什么时候做讲清楚。",
        "日常工具：精确计算、当前日期推算、真实天气——这类问题大模型心算或凭记忆回答并不可靠，必须走工具。",
        "图片提问：把赛事截图、成绩单、课程表拍照上传，直接问图里的评审权重是多少。",
    ])

    add_heading(doc, "2.2 功能需求", 2)
    add_table(
        doc,
        ["编号", "功能", "需求描述"],
        [
            ["FR-1", "执行计划", "复杂问题自动拆解为 2~5 步计划，步骤状态与真实执行严格对应"],
            ["FR-2", "知识库检索", "按知识域检索语料，回答标注引用编号并展示来源卡片；检索不到时如实说明"],
            ["FR-3", "工具调用", "计算 / 时间 / 真实天气 / 图片理解，统一 JSON Schema 契约，支持 MCP 动态工具"],
            ["FR-4", "多模态", "图片上传后由 Agent 自主调用图片理解工具，并与检索结果协同生成回答"],
            ["FR-5", "流式回答", "SSE 事件流推送 token，前端按帧渲染 Markdown"],
            ["FR-6", "对话管理", "多会话持久化、复制、重新生成、点赞点踩、停止生成（含服务端取消）"],
            ["FR-7", "多知识域", "同一 Agent 可在赛事备赛 / 校园学习 / 全部 之间切换检索范围"],
            ["FR-8", "语音交互", "浏览器端语音输入与回答朗读，不支持时优雅降级"],
            ["FR-9", "安全与治理", "输入风险拦截、输出密钥遮蔽与高风险标记、免责声明、限流与体积上限"],
        ],
        widths=[1.6, 2.6, 11.8],
    )
    add_caption(doc, "表 2-1 功能需求清单")

    add_heading(doc, "2.3 非功能需求", 2)
    add_table(
        doc,
        ["维度", "指标", "实现方式"],
        [
            ["可用性", "大模型/网络异常时不得白屏或抛栈", "三层兜底：请求超时重试 → 失败话术 → 全链路 try/catch"],
            ["稳定性", "单次请求 30s 超时，429/5xx 自动退避重试", "AbortController + 指数退避 + 可选降级模型"],
            ["可解释性", "每一次检索与工具调用都可追溯", "九类 SSE 事件 + 引用编号 + 词项覆盖率"],
            ["安全性", "不泄露密钥、不输出明显有害内容", "输出侧密钥遮蔽 + 输入归一化拦截 + 免责声明"],
            ["健壮性", "畸形请求不得打爆服务", "8MB 体积上限、IP 限流、history/message 严格校验"],
            ["可维护性", "改动可回归验证", "66 项单元测试 + ESLint + CI 门禁"],
        ],
        widths=[2.2, 5.6, 8.2],
    )

    page_break(doc)

    # ══════════ 3 系统架构设计 ══════════
    add_heading(doc, "3 系统架构设计", 1)
    add_heading(doc, "3.1 总体架构", 2)
    add_code(doc, [
        "┌────────────── 浏览器（React 18 + Vite + Tailwind）──────────────┐",
        "│ App ─ useAgentChat（SSE 客户端 / 按帧节流 / 多会话 / 重生成 / 反馈） │",
        "│        └ MessageView（计划时间线 · 工具卡片 · Markdown 流式 ·       │",
        "│                       来源引用 · 复制 / 重生成 / 朗读 / 反馈）     │",
        "│        └ useSpeech（Web Speech API 语音输入 / TTS 朗读）          │",
        "└────────────────────────────┬────────────────────────────────────┘",
        "                             │ POST /api/chat (SSE)   GET /api/health",
        "┌────────────────────────────┴────────────────────────────────────┐",
        "│ Agent 编排器 server/agent.ts                                     │",
        "│  理解 → 规划(LLM) → 行动(图片理解 / 多域检索 / 工具循环≤3轮)        │",
        "│                    → 生成(LLM 流式 + 输出治理) → 收尾(免责声明)    │",
        "│  ├ llm.ts     OpenAI 兼容客户端（超时 30s · 退避重试 · 降级 · 取消）│",
        "│  ├ rag.ts     多知识域 BM25 + 可插拔向量融合检索                   │",
        "│  ├ tools.ts   工具注册表（内置 4 个 + MCP 动态发现）               │",
        "│  ├ mcp.ts     MCP 客户端（initialize / tools/list / tools/call）   │",
        "│  ├ vision.ts  图片理解（可被 Agent 作为工具调用）                  │",
        "│  ├ safety.ts  输入拦截 · 输出遮蔽 · 免责声明 · 兜底话术            │",
        "│  ├ api.ts     SSE 端点 · 限流 · 体积上限 · 参数校验 · 断连取消      │",
        "│  ├ main.ts    生产服务器（静态托管 + gzip + SPA 回退）             │",
        "│  └ demo.ts    演示模式（检索与工具真实执行，回答由语料原文组织）    │",
        "└─────────────────────────────────────────────────────────────────┘",
    ])
    add_caption(doc, "图 3-1 系统总体架构")

    add_heading(doc, "3.2 事件协议设计", 2)
    add_para(
        doc,
        "前后端之间不复用宽松的聊天消息，而是定义了一套**九类事件的执行协议**（shared/protocol.ts）。"
        "前端只负责把事件渲染成界面，服务端只负责产生事件，职责单一、可独立演进。",
    )
    add_table(
        doc,
        ["事件", "载荷", "前端表现"],
        [
            ["status", "stage（understanding/planning/retrieving/tooling/answering/finished）", "思考状态文案"],
            ["plan", "steps：字符串数组", "执行计划时间线"],
            ["step_update", "index、status、note", "步骤状态与备注"],
            ["tool_call", "callId、name、args", "工具调用卡片（加载态）"],
            ["tool_result", "callId、ok、result{summary,data,display}", "按 display 渲染计算/天气/知识库/图片卡片"],
            ["token", "content", "流式正文（按帧批处理）"],
            ["sources", "sources[]（可为空数组）", "引用来源胶囊"],
            ["error", "message", "红色错误条（安全拦截、超时、异常）"],
            ["done", "meta{mode,model}", "结束流式、标注运行模式"],
        ],
        widths=[2.4, 7.6, 6.0],
    )
    add_caption(doc, "表 3-1 九类 SSE 事件")

    add_heading(doc, "3.3 模块划分", 2)
    add_table(
        doc,
        ["层", "模块", "职责"],
        [
            ["表现层", "src/App.tsx、components/*", "布局、空状态、移动端抽屉、消息渲染"],
            ["状态层", "src/hooks/useAgentChat.ts", "SSE 客户端、按帧节流、多会话持久化、重生成与反馈"],
            ["多模态层", "src/utils/image.ts、src/hooks/useSpeech.ts", "图片压缩与 HEIC 转码、语音输入与朗读"],
            ["编排层", "server/agent.ts", "理解→规划→行动→生成主循环、计划追踪、输出守卫"],
            ["能力层", "server/rag.ts、tools.ts、mcp.ts、vision.ts", "多域检索、工具执行、MCP 动态工具、图片理解"],
            ["接入层", "server/llm.ts、api.ts、main.ts、demo.ts", "模型客户端、SSE 端点与加固、生产服务器、演示模式"],
            ["治理层", "server/safety.ts", "输入归一化拦截、输出遮蔽、免责声明、兜底话术"],
        ],
        widths=[2.2, 5.6, 8.2],
    )

    add_heading(doc, "3.4 关键设计决策", 2)
    add_bullets(doc, [
        "**为什么用 SSE 而不是 WebSocket**：本场景是单向的服务端推送执行过程，SSE 语义更贴合、"
        "实现更简单，且能复用 HTTP 中间件做限流与体积控制。",
        "**为什么计划步骤要与真实动作绑定**：早期版本把计划第二步硬编码为检索中，"
        "当模型生成的计划第二步其实是调用计算工具时，界面就会出现张冠李戴的假进度。"
        "现在改为按关键词把工具映射到步骤（calculate→计算、get_weather→天气…），匹配不到就不发事件——"
        "**宁可少一条进度，也不给一条假进度**。",
        "**为什么图片要作为工具而不是旁路**：独立视觉通道只能做单轮看图问答，"
        "无法与检索、其它工具协同。改成工具后，图片信息进入主循环上下文，"
        "才能出现图中评审权重加官网原文引用这类融合回答。",
        "**为什么演示模式也要真实执行检索与工具**：在没有 API Key 的环境中，"
        "我们希望展示的仍然是真实的检索与真实的工具调用，只有自然语言组织退化为模板，"
        "从而保证演示的可复现性与诚实性。",
    ])

    page_break(doc)

    # ══════════ 4 AI 技术方案 ══════════
    add_heading(doc, "4 AI 技术方案", 1)
    add_para(
        doc,
        "本章按大赛评分细则的六个考察点逐项说明**选型理由、集成方式与优化策略**，"
        "并在每个小节给出可验证的证据（测试用例或线上实测现象）。",
    )

    add_heading(doc, "4.1 大模型集成质量（8%）", 2)
    add_para(
        doc,
        "**选型理由**：采用 OpenAI 兼容协议接入，内置 DeepSeek 与智谱 GLM 两套预设，"
        "不绑定单一厂商；既降低供应商风险，也便于用同一份代码对比不同模型的表现。",
    )
    add_para(
        doc,
        "**集成方式**：非流式用于规划（temperature 0.3，追求稳定），流式用于回答（temperature 0.6，追求流畅），"
        "图片理解使用 0.4；全部支持 Function Calling。",
    )
    add_para(doc, "**优化策略**（本轮重点补强）：")
    add_bullets(doc, [
        "**超时**：单次请求 30 秒（AI_TIMEOUT_MS 可调），避免网络卡死拖垮整个会话。",
        "**重试**：对 408/409/425/429/5xx 与网络抖动做指数退避重试（默认 3 次尝试），"
        "退避 400ms 起、封顶 4s 并带随机抖动，避免惊群。",
        "**降级**：配置 AI_FALLBACK_MODEL 后，主模型整体失败会自动切换备用模型。",
        "**取消**：全链路透传 AbortSignal，用户点停止或断开连接时立即取消上游请求，"
        "consumeSseStream 会主动 cancel 底层 reader，避免持续计费。",
        "**提示词约束**：System Prompt 明确规定始终使用简体中文，修复了实测中出现的中英混杂输出。",
    ])
    add_callout(
        doc,
        "证据：线上实测 token 流式稳定、无中英混杂输出；异常路径均有兜底话术。",
    )

    add_heading(doc, "4.2 Agent 规划与行动循环（8%）", 2)
    add_para(
        doc,
        "主循环为：**理解 → 规划 → 行动（图片理解 / 检索 / 工具循环，最多 3 轮）→ 生成 → 收尾**。"
        "规划阶段让模型输出 JSON 计划（强制 JSON + 默认计划兜底），行动阶段把工具结果回填进消息列表后继续生成，"
        "形成完整的规划-行动-观察闭环。",
    )
    add_para(doc, "**本轮的关键修复——计划可视化的真实性**：")
    add_table(
        doc,
        ["问题", "修复前", "修复后"],
        [
            ["步骤索引", "硬编码 index 0/1，与模型生成的计划无关", "PlanTracker 按关键词定位步骤，并保证同一时刻只有一个步骤处于进行中"],
            ["工具与步骤关系", "任何工具调用都标在同一个步骤上", "TOOL_STEP_KEYWORDS 把 calculate / get_weather / get_current_time / understand_image 分别映射到对应步骤"],
            ["匹配不到时", "仍会发出与实际不符的进度", "不发进度事件（宁可少一条，也不给假进度）"],
            ["阶段状态", "工具执行期间仍显示正在生成回答", "工具调用前后补发 status: tooling"],
            ["收尾", "时间线可能停留在进行中", "completeAll() 把未完成步骤按顺序补完"],
        ],
        widths=[2.4, 6.4, 7.2],
    )
    add_caption(doc, "表 4-1 计划与执行一致性修复对照")
    add_callout(
        doc,
        "线上实测：提问「帮我算一下 (128*46+372)/4 等于多少，顺便告诉我今天几号」，"
        "计划为两步，事件序列为 index0 running→done（calculate）→ index1 running→done（get_current_time），"
        "与实际工具调用完全一致。",
    )

    add_heading(doc, "4.3 RAG 多知识域混合检索（6%）", 2)
    add_para(
        doc,
        "**架构**：BM25 常驻 + 可插拔向量检索，两者分数各自归一化后按 0.45（BM25）/0.55（向量）加权融合。"
        "BM25 参数 k1=1.5、b=0.75；标题在索引中重复 4 次、分类重复 2 次，使标题命中的权重显著高于正文偶然命中。",
    )
    add_para(
        doc,
        "**多知识域**：每个知识域一个语料文件，**域内独立构建 IDF 与平均文档长度等统计量**，"
        "避免跨域稀释；检索既可限定单域，也可跨域。新增场景只需登记一个域并放入一个 JSON 文件。",
    )
    add_para(
        doc,
        "**可解释的相关度**：早期版本把融合分统一归一化后，最高分恒为 1.00，"
        "界面上的最高相关度 1.00 没有任何信息量。现在改为展示 **词项覆盖率**"
        "（查询词项在命中文档中的覆盖率）并标注所属知识域，例如"
        "「[校园学习] 召回 3 条，最高词项覆盖率 62%」。",
    )
    add_para(
        doc,
        "**降级策略**：向量索引构建失败或查询向量失败时静默回退 BM25，检索层永不抛错；"
        "未配置 EMBEDDING_API_KEY 时使用纯 BM25，功能完整可用。",
    )
    add_table(
        doc,
        ["知识域", "篇数", "内容范围"],
        [
            ["赛事备赛 competition", "31", "大赛规程、评审细则、提交要求、奖项设置，以及 16 条赛道的介绍"],
            ["校园学习 campus", "15", "选课学分、绩点保研、四六级与考研时间线、实习就业、学术规范、心理与事务办理"],
        ],
        widths=[4.2, 1.8, 10.0],
    )
    add_caption(doc, "表 4-2 双知识域语料构成")

    add_heading(doc, "4.4 多模态图片理解（5%）", 2)
    add_para(
        doc,
        "**融合方式**：图片理解被封装为 understand_image 工具（而不是独立旁路）。"
        "用户上传图片后，Agent 先调用该工具获得结构化描述，把描述注入系统上下文，"
        "再与知识库检索结果一起生成最终回答，因此可以出现图中权重加官网原文引用的融合结论。",
    )
    add_para(
        doc,
        "**工程细节**：前端对图片做本地归一化——长边压到 1600px、JPEG 质量 0.85、"
        "HEIC（iPhone 相册格式）统一转码为 JPEG；服务端二次校验"
        "（仅接受 data:image/ 前缀、单图体积上限、一次最多 2 张）。"
        "未配置视觉模型时返回可执行的配置引导；配置了但调用失败时明确区分未配置与调用失败，并给出排查建议。",
    )
    add_callout(
        doc,
        "线上实测：上传测试图片后，事件序列为 understanding→planning→tooling→retrieving→answering，"
        "模型自主调用 understand_image 准确转写出图中的标题、截止时间、组别与编号，"
        "并在回答中与知识库引用 [1] 合并。",
    )

    add_heading(doc, "4.5 AI 安全与可控性（4%）", 2)
    add_para(doc, "采用输入拦截、输出治理、兜底降级三道防线，并明确其能力边界（规则级，非模型级）：")
    add_table(
        doc,
        ["防线", "机制", "实现要点"],
        [
            ["输入侧", "归一化风险拦截", "先做全角转半角、去空白与装饰符号、统一小写，再匹配 8 类风险规则；赌 博、赌*博 等简单绕过写法同样命中；命中后发 error 事件（前端红色错误条）"],
            ["输出侧", "密钥遮蔽 + 高风险标记", "流式输出按 64 字符尾缓冲扫描，遮蔽疑似 API Key 与令牌（跨 chunk 也能命中）；若模型输出复现高危内容，追加安全提示"],
            ["合规", "专业建议免责声明", "涉及医疗/法律/投资等关键词时自动追加免责声明（真实模式与演示模式一致生效）"],
            ["抗滥用", "限流与体积上限", "每 IP 60 秒 30 次滑动窗口限流（429 + Retry-After）；请求体上限 8MB；消息 4000 字上限"],
            ["降级", "兜底话术", "任何异常都转为友好提示，绝不把堆栈抛给用户"],
        ],
        widths=[1.8, 3.4, 10.8],
    )
    add_caption(doc, "表 4-3 AI 安全三道防线")
    add_callout(
        doc,
        "诚实披露：当前为规则级实现，应对校园与备赛等低对抗场景足够；"
        "面向公网开放的生产系统建议叠加专业内容审核 API 或分类模型，已列入路线图。",
    )

    add_heading(doc, "4.6 MCP 与工具集成（4%）", 2)
    add_para(
        doc,
        "**内置工具**（统一 JSON Schema 契约，与 Function Calling 直接对接）："
        "calculate（递归下降解析器，不使用 eval，支持 + - * / % 与括号）、"
        "get_current_time、get_weather（真实数据源 Open-Meteo，免 Key，支持全球城市）、understand_image。",
    )
    add_para(
        doc,
        "**标准 MCP 客户端**（本轮新增）：实现了 MCP 的 Streamable HTTP 传输与 JSON-RPC 2.0 方法子集——"
        "initialize → notifications/initialized → tools/list → tools/call。"
        "通过 MCP_SERVERS 环境变量声明一个或多个 Server 后，远端工具会被**动态发现**、"
        "转换为 Function Calling Schema 并注册进同一张工具表，与内置工具无差别参与 Agent 决策；"
        "调用结果中的 content 数组会被拼接为文本回填模型。",
    )
    add_code(doc, [
        "# 环境变量声明即可接入，无需改代码",
        "MCP_SERVERS=[{\"name\":\"filesystem\",\"url\":\"https://your-mcp-host/mcp\",",
        "              \"headers\":{\"Authorization\":\"Bearer xxx\"}}]",
        "# 或单个 Server 简写",
        "MCP_SERVER_URL=https://your-mcp-host/mcp",
    ])
    add_para(
        doc,
        "**可靠性设计**：工具清单带 5 分钟 TTL 缓存，避免每次问答都做一次握手；"
        "未配置、网络不可达或协议不兼容时静默降级为内置工具，不阻塞主流程；"
        "调用失败会作为工具失败结果回填模型，由模型向用户如实说明。",
    )
    add_callout(
        doc,
        "证据：tests/mcp.test.ts 用一个真实的本地 HTTP MCP Server 跑通"
        "握手 → tools/list → tools/call → 统一 executeTool 调用 全链路，"
        "并覆盖未配置、非法配置、服务不可达三类降级路径。",
    )

    page_break(doc)

    # ══════════ 5 核心功能实现 ══════════
    add_heading(doc, "5 核心功能实现", 1)

    add_heading(doc, "5.1 执行计划可视化", 2)
    add_para(
        doc,
        "这是本作品最核心的交互创新，也是本轮重点修复的正确性问题。计划时间线的每一步状态"
        "都由服务端的真实动作驱动：检索开始时点亮检索步骤，某个工具被调用时点亮对应步骤，"
        "调用结束立即置为完成，收尾阶段把剩余步骤补齐。前端只做渲染，不猜测状态。",
    )
    add_para(
        doc,
        "实现要点：PlanTracker 持有步骤数组与状态数组，通过关键词定位步骤；"
        "保证同一时刻至多一个步骤处于进行中；重复更新同一状态会被忽略（幂等）；"
        "收尾调用 completeAll() 兜底，避免时间线永远停留在进行中。",
    )

    add_heading(doc, "5.2 流式输出与思考状态可视化", 2)
    add_para(
        doc,
        "服务端以 SSE 逐段推送 token，前端 useAgentChat 把 token 累积到缓冲区，"
        "通过 requestAnimationFrame 按帧刷新一次状态，把早期每个 token 一次 setState 的开销"
        "降低到每帧一次；长文本流式渲染时输入框与滚动不再卡顿。",
    )
    add_para(
        doc,
        "状态条用六阶段文案（理解问题 / 制定计划 / 检索知识库 / 调用工具 / 生成回答 / 已完成）"
        "呈现 Agent 的思考过程；工具执行阶段会明确显示正在调用工具，而不是笼统的正在生成。",
    )

    add_heading(doc, "5.3 工具卡片与来源引用", 2)
    add_para(
        doc,
        "工具结果通过 display 字段驱动生成式 UI：计算结果渲染为等宽的表达式等于结果卡片，"
        "天气渲染为城市、天气、温度、提示的结构卡片并标注数据来源（实时 / 离线样例），"
        "知识库检索渲染为召回摘要卡并给出词项覆盖率，图片理解渲染为描述摘要卡。",
    )
    add_para(
        doc,
        "知识库检索结果以编号引用显示在句末，底部来源胶囊悬停可查看原文摘要；"
        "即使检索不到高相关内容，也会发送空的 sources 事件，让用户明确知道系统已经检索过。",
    )

    add_heading(doc, "5.4 多知识域与场景迁移", 2)
    add_para(
        doc,
        "系统内置两个知识域：赛事备赛（31 篇）与校园学习（15 篇）。用户可在侧栏一键切换，"
        "服务端对 domain 参数做白名单校验后限定检索范围，并在系统提示中告知模型当前挂载的知识域。",
    )
    add_para(
        doc,
        "这一设计的价值不只是功能本身，而是**证明架构的可迁移性**："
        "新增一个场景（例如企业知识库、政务办事指引）只需放入一份 JSON 语料并登记一个域，"
        "规划、检索、工具、引用、安全治理全部复用。这是本作品从备赛工具走向通用可信问答引擎的关键一步。",
    )

    add_heading(doc, "5.5 语音交互", 2)
    add_para(
        doc,
        "基于浏览器原生 Web Speech API 实现，无第三方依赖："
        "输入侧提供语音转文字按钮，识别结果追加到输入框，识别中的临时文本实时回显；"
        "回答侧提供朗读按钮，朗读前会剥离 Markdown 记号与代码块，避免读出无意义符号。"
        "浏览器不支持或未授权麦克风时，按钮隐藏或给出明确提示，不影响文字交互。",
    )

    add_heading(doc, "5.6 会话持久化与对话操作", 2)
    add_para(
        doc,
        "会话与消息保存在 localStorage，刷新或重开页面后自动恢复；"
        "支持新建、切换、删除会话，并会在新建时清理历史遗留的空会话。"
        "每条回答下方提供复制、重新生成、有帮助、需改进四个操作，"
        "反馈随会话一起持久化，可用于后续收集真实使用评价。"
        "用户点停止时前端中断连接，服务端同步取消上游请求。",
    )

    add_heading(doc, "5.7 演示模式设计", 2)
    add_para(
        doc,
        "未配置 API Key 时自动进入演示模式：完整走一遍规划 → 检索 → 工具 → 流式回答的流水线，"
        "其中检索与工具是**真实执行**，回答由知识库原文要点组织并保留引用编号，不做无依据编造。"
        "这样即使评审在无外网、无密钥的环境下复现，看到的也是真实的能力而非静态截屏。",
    )

    page_break(doc)

    # ══════════ 6 创新点说明 ══════════
    add_heading(doc, "6 创新点说明", 1)
    add_heading(doc, "6.1 技术创新点", 2)
    add_table(
        doc,
        ["编号", "创新点", "说明"],
        [
            ["T1", "计划与执行严格映射的透明化 Agent", "不是把计划当装饰动画，而是把每一个工具调用、每一次检索映射回计划步骤；匹配不到就不发进度，用'宁可少一条，不给假进度'保证可视化的可信度"],
            ["T2", "多知识域 + 域内独立统计的混合检索", "每域独立构建 BM25 统计量避免跨域稀释 IDF；配置 Embedding 后自动升级为 0.45/0.55 融合检索；相关度以词项覆盖率解释而非无信息量的归一化分数"],
            ["T3", "多模态作为工具进入主循环", "图片理解被封装为 understand_image 工具参与规划与工具循环，可与检索结果协同生成，而非独立的单轮看图问答"],
            ["T4", "标准 MCP 客户端与动态工具发现", "实现 MCP Streamable HTTP 传输与 initialize / tools/list / tools/call 方法子集，远端工具动态注册进同一张工具表，与内置工具无差别参与决策"],
            ["T5", "演示与真实双模式同构", "无密钥时检索与工具仍真实执行，只有自然语言组织退化为模板，保证可复现性与诚实性"],
            ["T6", "流式输出治理", "输出按 64 字符尾缓冲扫描遮蔽疑似密钥（跨 chunk 生效），并在结尾统一追加免责声明"],
        ],
        widths=[1.4, 4.6, 10.0],
    )
    add_caption(doc, "表 6-1 技术创新点")

    add_heading(doc, "6.2 应用创新点", 2)
    add_bullets(doc, [
        "**全过程透明的人机协作范式**：把 AI 的黑盒回答变成可回放、可核查的执行记录，"
        "让用户从相信模型转变为验证依据。",
        "**一张知识库支撑多场景**：赛事备赛与校园学习共用同一套 Agent，"
        "说明该范式可迁移至校园服务、企业知识管理与政务办事指引等高价值场景。",
        "**低门槛可复现**：天气使用免 Key 的真实数据源，检索在无 Embedding 时仍完整可用，"
        "评审无需额外配置即可验证核心能力。",
        "**无障碍增强**：语音输入与朗读让不便键盘输入的用户也能使用。",
    ])

    page_break(doc)

    # ══════════ 7 社会价值与商业潜力 ══════════
    add_heading(doc, "7 社会价值与商业潜力", 1)

    add_heading(doc, "7.1 社会价值", 2)
    add_para(
        doc,
        "**缩小信息差，促进教育公平。** 备赛与升学信息长期集中在少数信息灵通的学生手里："
        "官网公告、赛道详情、培养方案、政策文件分散在不同入口，检索成本高，"
        "而通用大模型又不可信（会编造截止时间）。本作品把这些权威信息整理为可检索语料，"
        "用引用编号把答案锁定到原文，让任何一所学校、任何一个学生都能得到与信息灵通者同等质量的信息服务。",
    )
    add_para(
        doc,
        "**以透明化对抗幻觉，推动可信 AI 落地。** 可信 AI 的核心不是让答案更像人，"
        "而是让答案能被验证。本作品把执行计划、检索证据、工具结果与引用来源同时呈现，"
        "为用户提供了判断答案可信度的依据，也为 AI 在教育、医疗、政务等高风险场景落地"
        "提供了一个低成本的工程范式：**先透明，再智能**。",
    )
    add_para(
        doc,
        "**无障碍与包容性。** 语音输入与朗读降低了使用门槛，"
        "对视障用户、行动不便用户以及不擅长键盘输入的用户更友好。",
    )

    add_heading(doc, "7.2 目标用户与使用场景", 2)
    add_table(
        doc,
        ["用户群体", "核心诉求", "付费意愿", "切入方式"],
        [
            ["高校在校生（C 端，规模大）", "备赛咨询、学业规划、日常工具", "低（但可转化为口碑与数据）", "免费版：单知识域 + 全部工具"],
            ["高校教务 / 就业指导中心（B 端）", "政策与流程问答自动化，答案必须可溯源", "中高（预算稳定、可年度续费）", "订阅制：知识库接入 + 多席位"],
            ["教育机构 / 企业培训部门（B 端）", "私有知识库问答，数据不出内网", "高（客单价高）", "私有化部署授权 + 年度运维"],
            ["企业知识管理团队（B 端）", "内部制度、技术文档问答", "高", "按席位订阅 + 定制语料工程"],
        ],
        widths=[4.2, 4.2, 3.0, 4.6],
    )
    add_caption(doc, "表 7-1 目标用户与付费结构")

    add_heading(doc, "7.3 商业模式与定价", 2)
    add_para(doc, "采用**B 端订阅为主、C 端增值为辅**的双轨模式：")
    add_bullets(doc, [
        "**B 端 SaaS 订阅**：按席位与知识域数量计费，含语料工程、检索调优与年度运维；"
        "面向高校与培训机构，建议定价区间为每校每年 3 至 5 万元（含 50 至 200 席位）。",
        "**私有化部署授权**：一次性授权费加年度运维费，面向对数据边界敏感的企业与政务客户。",
        "**C 端增值**：免费版提供单一知识域与全部工具；会员版（建议 9.9 元/月）解锁"
        "多知识域、答案导出、语音高级音色与个人知识库上传。",
        "**增值服务**：语料整理与知识工程实施——这是很多 B 端客户真正的痛点，"
        "也是我们已具备的能力（本作品的 46 篇语料即为自建）。",
    ])

    add_heading(doc, "7.4 市场空间估算", 2)
    add_para(
        doc,
        "以高校市场为第一站：全国高等院校约 3000 余所，若按每校年均 3 至 5 万元的教育产品采购额保守测算，"
        "仅高校教务与就业指导方向的市场容量即在 **1 亿至 1.5 亿元/年** 量级；"
        "叠加企业培训、考试培训与内部知识管理需求，可触达市场显著更大。",
    )
    add_para(
        doc,
        "从用户侧看，全国在校本专科生与研究生规模在数千万量级，"
        "即便只有 1% 的学生成为活跃用户、其中 5% 转化为会员，也对应百万级付费用户体量，"
        "足以支撑一个健康的垂直产品。",
    )
    add_callout(
        doc,
        "说明：本节数据为基于公开规模的量级估算，用于说明商业可行性，不构成收入承诺。",
    )

    add_heading(doc, "7.5 竞争格局与差异化", 2)
    add_table(
        doc,
        ["对比对象", "优势", "本作品的差异化"],
        [
            ["通用助手（Kimi / 文心 / 通义）", "模型能力强、生态大", "不拼模型，拼**垂直权威语料 + 过程可视化 + 引用溯源**；通用助手难以保证校园政策的时效与准确"],
            ["校园官网 / 教务系统", "信息权威", "传统系统是检索式与表单式，用户需要自己找；本作品是对话式且答案带出处，还支持图片与语音"],
            ["其他 AI 助手类参赛作品", "功能相近", "多数作品止步于“能聊天”；本作品把**执行过程做成可验证的证据链**，并实现了标准 MCP 工具发现与多知识域迁移"],
            ["企业知识问答产品", "面向 B 端成熟", "本作品在架构上与其同构但更轻量，且已验证双模式与无密钥可复现，适合预算有限的高校与中小机构"],
        ],
        widths=[4.4, 3.6, 8.0],
    )
    add_caption(doc, "表 7-2 竞争格局与差异化定位")

    add_heading(doc, "7.6 成本结构与可持续性", 2)
    add_para(
        doc,
        "**成本侧**：推理成本是用量线性增长的主要成本项。本作品通过三项工程手段压低边际成本——"
        "**检索优先**（先查语料再生成，减少无效生成）、**工具替代心算**（精确计算与时间不消耗推理 token）、"
        "**按帧节流与响应长度约束**（降低前端与模型双侧开销）。此外 BM25 常驻、向量可选，"
        "使无 Embedding 的环境也能零外部依赖运行。",
    )
    add_para(
        doc,
        "**收入侧与黏性**：知识库是可沉淀的数据资产，随赛事周期与培养方案更新持续迭代，"
        "形成订阅粘性；语料工程能力可复制到新客户，边际交付成本递减。",
    )
    add_para(
        doc,
        "**可持续性的工程前提**：系统在无外网密钥时进入演示模式仍可用，"
        "这意味着校园内网、涉密单位的私有化部署成为可能——这正是 B 端采购的关键门槛。",
    )

    add_heading(doc, "7.7 风险与应对", 2)
    add_table(
        doc,
        ["风险", "影响", "应对措施"],
        [
            ["大模型幻觉仍未完全消除", "错误结论损害信任", "引用编号强制溯源 + 检索不到时如实说明 + 工具替代心算 + 输出侧治理"],
            ["模型服务中断或额度耗尽", "在线演示不可用", "超时重试与降级模型；自动进入演示模式；健康检查定时探活并留痕"],
            ["知识库时效性", "政策更新后答案过期", "语料自带版本字段与来源标注；规划中的后台更新与版本对比能力"],
            ["数据与隐私合规", "B 端采购风险", "默认不收集用户数据；支持私有化部署；密钥仅通过环境变量注入"],
            ["同质化竞争", "评审区分度不足", "以过程透明化与 MCP 工具生态作为差异化技术锚点，持续补齐端侧与语音能力"],
        ],
        widths=[4.0, 3.4, 8.6],
    )
    add_caption(doc, "表 7-3 风险与应对")

    page_break(doc)

    # ══════════ 8 测试与部署 ══════════
    add_heading(doc, "8 测试与部署", 1)
    add_heading(doc, "8.1 测试策略与用例", 2)
    add_para(
        doc,
        "采用 Vitest 做服务端逻辑的单元与集成测试，总计 **66 项用例**，全部离线可复现"
        "（MCP 测试使用本地 HTTP 服务器模拟真实握手，不依赖外网）。",
    )
    add_table(
        doc,
        ["测试文件", "用例数", "覆盖范围"],
        [
            ["tests/rag.test.ts", "16", "BM25 召回准确性、topK 限制、分数区间与排序、来源映射、相关性判定，以及多知识域的域隔离与跨域检索"],
            ["tests/tools.test.ts", "19", "计算器精确求值（6 组）、除零与非法输入、时间工具、天气真实数据解析与 WMO 映射、失败不返回假数据、图片理解工具、Schema 契约完整性、工具名唯一性"],
            ["tests/mcp.test.ts", "8", "MCP 配置解析、工具名转换、真实 HTTP 握手与 tools/list、通过统一 executeTool 调用远端工具、未配置与不可达的降级"],
            ["tests/safety.test.ts", "12", "风险话题拦截与变形绕过、归一化、输出密钥遮蔽、高风险输出标记、免责声明"],
            ["tests/vision.test.ts", "8", "图片格式与数量校验、视觉消息构建、未配置的引导话术、已配置但失败的可执行提示"],
            ["tests/agent-demo.test.ts", "3", "演示模式完整流水线：数学问题走工具、赛事问题带引用、风险输入直接拒绝且不调用工具"],
        ],
        widths=[4.4, 1.6, 10.0],
    )
    add_caption(doc, "表 8-1 测试用例分布")

    add_heading(doc, "8.2 构建与运行", 2)
    add_code(doc, [
        "npm install        # 安装依赖",
        "npm run dev        # 开发模式（http://localhost:5173）",
        "npm test           # 66 项单元测试",
        "npm run lint       # ESLint 门禁",
        "npm run typecheck  # TypeScript 严格模式类型检查",
        "npm run build      # 类型检查 + 生产构建（分包）",
        "npm run server     # 独立生产服务器（静态托管 + gzip + /api，默认 8787）",
    ])
    add_para(
        doc,
        "环境变量通过 .env（本机）或平台环境变量（部署）注入，全部可配置项已在 .env.example 中列出，"
        "包含大模型、视觉模型、向量检索、天气模式、MCP、限流与体积上限等分组说明。",
    )

    add_heading(doc, "8.3 部署方案", 2)
    add_para(
        doc,
        "提供四条部署路线（详见仓库 DEPLOY.md）：**Railway / Render**（连接仓库自动部署，推荐）、"
        "**Docker**（镜像内不含任何密钥，运行时注入）、**裸机 + pm2**。"
        "在线演示地址：https://zhixing-agent-production.up.railway.app",
    )
    add_para(
        doc,
        "为什么不用 Serverless 静态托管：本作品的 /api/chat 是基于常驻连接的 SSE 流式接口，"
        "需要长驻进程承载，因此选择 Railway / Render / Docker 这类长驻方案；"
        "如需迁移到 Serverless，可将 server 层改写为 Next.js Route Handler（已列入路线图）。",
    )

    add_heading(doc, "8.4 评审期服务保障", 2)
    add_bullets(doc, [
        "**保活**：GitHub Actions 每 10 分钟探活一次 /api/health，"
        "既避免免费档实例休眠，也在服务异常时于 Actions 留下红色记录（可通过仓库变量 DEMO_URL 切换地址）。",
        "**额度**：评审期使用独立 API Key 并预留额度；即使额度耗尽，应用会自动进入演示模式，检索与工具仍然真实执行。",
        "**降级预案**：演示视频与本地运行记录作为兜底证据；/api/health 可随时确认当前模式、知识库规模与图片理解可用性。",
    ])

    page_break(doc)

    # ══════════ 9 总结与展望 ══════════
    add_heading(doc, "9 总结与展望", 1)
    add_heading(doc, "9.1 当前成果", 2)
    add_para(
        doc,
        "知行 Agent 已完成从“能聊天”到“可验证”的完整闭环：透明的执行计划、可追溯的引用、"
        "真实的外部工具、进入主循环的多模态、标准 MCP 工具发现、多知识域场景迁移、"
        "以及输入输出双侧的安全治理。工程质量上，约 4800 行 TypeScript 通过严格类型检查与 ESLint，"
        "66 项单元测试与 CI 门禁保证可回归，生产构建完成代码分割与 gzip 优化，"
        "线上演示地址持续可用。",
    )

    add_heading(doc, "9.2 路线图", 2)
    add_table(
        doc,
        ["阶段", "事项", "价值"],
        [
            ["近期", "知识库升级为向量入库（pgvector / Milvus），支持文档上传与自动分块", "从固定语料走向用户自有语料"],
            ["近期", "接入更多标准 MCP Server（文件系统、浏览器、数据库），实现工具动态发现", "从自建工具走向生态工具"],
            ["中期", "端侧智能：Transformers.js / WebGPU 浏览器端小模型推理", "降低推理成本与隐私风险"],
            ["中期", "生成式 UI 增强：工具结果渲染为图表与时间线（ECharts）", "提升信息密度与可读性"],
            ["中期", "Multi-Agent 编排：Planner / Executor / Reviewer 三角色协作", "复杂任务的质量与可靠性提升"],
            ["远期", "多租户与权限体系、语料版本管理与评测集", "具备真正的 B 端交付能力"],
        ],
        widths=[1.8, 8.4, 5.8],
    )

    add_heading(doc, "9.3 团队信息", 2)
    add_table(
        doc,
        ["项目", "内容"],
        [
            ["队伍名称", "＿＿＿＿＿＿（提交前填写）"],
            ["成员及分工", "＿＿＿＿＿＿（提交前填写）"],
            ["指导老师", "＿＿＿＿＿＿（提交前填写）"],
            ["参赛组别", "B 组（非 985/211 普通本科院校本科生）"],
        ],
        widths=[3.4, 12.6],
    )
    add_caption(doc, "表 9-1 团队信息")

    doc.save(OUT_DOCX)
    print("已生成:", os.path.abspath(OUT_DOCX))



if __name__ == "__main__":
    build()
