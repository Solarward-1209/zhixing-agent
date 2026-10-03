# 技术文档生成流水线

当前（推荐）流水线 —— 不依赖额外 pip 包，使用运行环境自带的 python-docx：

```bash
# 1) 生成 DOCX（内容在 build_docx.py，含第 7 章「社会价值与商业潜力」）
python build_docx.py

# 2) 渲染为 PDF（使用 DSH 内置 LibreOffice Kit）
node <libreofficeKit.cli> convert --input ../知行Agent技术文档.docx --output ../知行Agent技术文档.pdf
```

- 产出：`docs/知行Agent技术文档.docx` 与 `docs/知行Agent技术文档.pdf`
- 页数约 23 页（大赛要求不超过 30 页）
- 团队信息在 build_docx.py 的 9.3 节与封面表格中，填写后重新生成即可

历史流水线（ReportLab，需要 pip install reportlab pypdf）：`gen_techdoc.py` 生成正文、
`merge.py` 合并封面。该流水线内容已过期，保留仅作参考，正式提交请使用 build_docx.py。
