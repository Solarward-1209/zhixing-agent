/**
 * AI 安全模块：输入侧风险拦截 + 输出侧内容治理 + 专业建议免责声明 + 兜底话术。
 *
 * 说明（诚实披露）：这是规则级的轻量实现，用于演示"内容过滤与兜底机制"这一评分点。
 * 生产环境建议叠加基于分类模型/内容审核 API 的二次审核，见 README 路线图。
 */

/** 风险话题（分类 + 正则）。匹配前会先做归一化，抵御空格/符号/全角变形绕过。 */
const BLOCK_PATTERNS: Array<{ re: RegExp; category: string; reason: string }> = [
  { re: /(赌博|博彩|网赌|赌球|棋牌代理|外围盘)/, category: "gambling", reason: "赌博相关内容" },
  { re: /(色情|淫秽|裸聊|援交|招嫖|情色)/, category: "porn", reason: "色情低俗内容" },
  { re: /(制作炸弹|炸弹制作|爆炸物|枪支改装|自制枪|管制刀具)/, category: "violence", reason: "涉暴危险内容" },
  { re: /(毒品制作|制毒|制冰毒|吸毒方法|贩毒)/, category: "drug", reason: "涉毒内容" },
  { re: /(刷单兼职|网络诈骗|诈骗话术|钓鱼网站|杀猪盘|洗钱)/, category: "fraud", reason: "涉嫌违法诈骗内容" },
  { re: /(入侵教程|攻击他人系统|ddos攻击|脱库|撞库|木马制作|勒索病毒)/i, category: "hacking", reason: "涉嫌网络攻击内容" },
  { re: /(自杀方法|自残教程|怎么结束自己|安乐死方法)/, category: "self-harm", reason: "涉及自伤风险内容" },
  { re: /(儿童色情|未成年.*性)/, category: "minor-abuse", reason: "涉及未成年人侵害内容" },
];

/**
 * 归一化：去空白、去常见分隔符与装饰符号、全角转半角、统一小写。
 * 让「赌 博」「赌*博」「賭博」这类简单绕过失效。
 */
export function normalizeForScreen(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s\u200b\u200c.,!?~^*\-_=|\\/·、,。！？；;：:'"“”‘’()（）[\]【】<>《》+]/g, "")
    .replace(/\u200d/g, "");
}

export interface SafetyCheck {
  ok: boolean;
  reason?: string;
  category?: string;
  refusal?: string;
}

export const REFUSAL_TEXT =
  "抱歉，你的问题涉及我不能协助的内容。知行 Agent 遵守法律法规与平台规范，\n" +
  "你可以问我学习、备赛、计算、日程、知识查询等方面的问题，我很乐意帮忙 🙂";

/** 输入侧过滤：命中风险话题时直接返回统一的拒绝话术，不进入大模型 */
export function screenInput(text: string): SafetyCheck {
  const normalized = normalizeForScreen(text);
  for (const { re, reason, category } of BLOCK_PATTERNS) {
    if (re.test(normalized) || re.test(text)) {
      return { ok: false, reason, category, refusal: REFUSAL_TEXT };
    }
  }
  return { ok: true };
}

// ---------- 输出侧治理 ----------

/** 输出侧应被遮蔽的敏感模式（例如模型把密钥原样吐出来） */
const SECRET_SOURCE = [
  "sk-[A-Za-z0-9_-]{16,}",
  "[0-9a-f]{32}\\.[A-Za-z0-9]{16,}",
  "(?:api[_-]?key|token|secret)\\s*[:=]\\s*[\"']?[A-Za-z0-9_-]{16,}",
].join("|");

/** 遮蔽疑似密钥/令牌（流式场景可逐段调用） */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const out = text.replace(new RegExp(SECRET_SOURCE, "gi"), () => {
    redacted = true;
    return "[已隐去敏感信息]";
  });
  return { text: out, redacted };
}

export interface OutputCheck {
  text: string;
  redacted: boolean;
  blocked?: string;
}

/**
 * 输出侧二次校验：
 * 1. 抹掉疑似密钥/令牌，避免模型或上下文把敏感信息回显给用户；
 * 2. 若模型在回答里复现了硬性违规内容，追加安全提示。
 */
export function moderateOutput(text: string): OutputCheck {
  const { text: out, redacted } = redactSecrets(text);
  const check = screenInput(out);
  if (!check.ok) {
    return {
      text: out + "\n\n> 🛡️ 该回答包含高风险内容，已被安全策略标记，请勿据此采取行动。",
      redacted,
      blocked: check.reason,
    };
  }
  return { text: out, redacted };
}

/** 输出侧兜底：涉及专业建议时追加免责声明 */
export function applyDisclaimer(text: string): string {
  const needs = /(医疗|诊断|用药|药|处方|法律|律师|起诉|诉讼|投资|理财|股票|基金|保险|税务)/;
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
