#!/usr/bin/env python3
"""合并封面与正文，写入元数据。"""
import json
import sys

from pypdf import PdfReader, PdfWriter, Transformation

A4_W, A4_H = 595.28, 841.89


def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 2 or abs(h - A4_H) > 2:
        sx, sy = A4_W / w, A4_H / h
        page.add_transformation(Transformation().scale(sx=sx, sy=sy))
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (A4_W, A4_H)
    return page


def main():
    cover_pdf, body_pdf, output_pdf = sys.argv[1], sys.argv[2], sys.argv[3]
    meta = json.load(open('cover.json', encoding='utf-8'))
    writer = PdfWriter()
    writer.add_page(normalize_page_to_a4(PdfReader(cover_pdf).pages[0]))
    for page in PdfReader(body_pdf).pages:
        writer.add_page(normalize_page_to_a4(page))
    writer.add_metadata({
        '/Title': '知行 Agent 技术文档 - 传智杯 AI WEB 网页开发挑战赛参赛作品',
        '/Author': '知行 Agent 团队',
        '/Creator': '知行 Agent 团队',
        '/Subject': 'AI Agent 智能助手：需求分析、系统架构、AI 技术方案、核心功能实现、测试与部署、创新点说明',
    })
    with open(output_pdf, 'wb') as f:
        writer.write(f)
    print('合并完成:', output_pdf)


if __name__ == '__main__':
    main()
