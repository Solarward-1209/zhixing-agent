/**
 * AI 安全模块（规则级实现，覆盖内容过滤与兜底机制；
 * 进阶方向为分类模型审核与人工抽检，见 README 路线图）。
 */

/** 高风险话题拦截规则（演示用最小集合） */
const BLOCK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /(赌博|博彩|网赌|棋牌代理)/, reason: "赌博相关内容" },
  { re: /(色情|淫秽|裸聊|援交)/, reason: "色情低俗内容" },
  { re: /(制作炸弹|爆炸物制造|枪支改装)/, reason: "涉暴危险内容" },
  { re: /(毒品制作|制毒)/, reason: "涉毒内容" },
  { re: /(刷单兼职|网络诈骗话术|钓鱼网站搭建)/, reason: "涉嫌违法诈骗内容" },
  { re: /(攻击他人系统|入侵教程|ddos攻击代码)/i, reason: "涉嫌网络攻击内容" },
];

export interface SafetyCheck {
  ok: boolean;
  reason?: string;
  refusal?: string;
}

/** 输入侧过滤：命中风险话题时直接返回统一的拒绝话术，不进入大模型 */
export function screenInput(text: string): SafetyCheck {
  for (const { re, reason } of BLOCK_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        reason,
        refusal:
          "抱歉，你的问题涉及我不能协助的内容。知行 Agent 遵守法律法规与平台规范，\n" +
          "你可以问我学习、备赛、计算、日程、知识查询等方面的问题，我很乐意帮忙 🙂",
      };
    }
  }
  return { ok: true };
}

/** 输出侧兜底：涉及专业建议时追加免责声明 */
export function applyDisclaimer(text: string): string {
  const needs = /(医疗|诊断|药|处方|法律|律师|起诉|投资|理财|股票|基金)/;
  if (needs.test(text)) {
    return (
      text +
      "\n\n> ⚠️ 免责声明：以上内容仅为 AI 生成的通用信息，不构成医疗、法律或投资建议。涉及重大决策请咨询持证专业人士。"
    );
  }
  return text;
}

/** 统一的兜底回复（工具连续失败 / 模型异常时使用，保证优雅降级） */
export const FALLBACK_REPLY =
  "抱歉，我这次没能顺利完成回答。可能是网络或模型服务暂时不稳定，请稍后重试。\n" +
  "如果问题持续，可以换个更简洁的问法，或先浏览知识库中的赛事常见问题。";
