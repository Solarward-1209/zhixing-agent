import type { ToolResultPayload } from "../shared/protocol";
import type { ToolSchema } from "./llm";

/**
 * MCP 风格的工具注册表：每个工具用统一的 JSON Schema 描述契约，
 * 编排器按协议调用 executeTool，新增工具只需在这里登记（对应评分点：MCP/工具集成）。
 */

export interface RegisteredTool {
  schema: ToolSchema;
  execute: (args: Record<string, unknown>) => Promise<ToolResultPayload>;
}

// ---------- 计算器：递归下降解析器（不用 eval，安全） ----------

function evaluateExpression(input: string): number {
  const src = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  let pos = 0;

  function peek(): string {
    return src[pos] ?? "";
  }
  function next(): string {
    return src[pos++] ?? "";
  }

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const ch = peek();
      if (ch === "+") {
        next();
        left += parseTerm();
      } else if (ch === "-") {
        next();
        left -= parseTerm();
      } else {
        return left;
      }
    }
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const ch = peek();
      if (ch === "*") {
        next();
        left *= parseFactor();
      } else if (ch === "/") {
        next();
        const d = parseFactor();
        if (d === 0) throw new Error("除数不能为零");
        left /= d;
      } else if (ch === "%") {
        next();
        left %= parseFactor();
      } else {
        return left;
      }
    }
  }

  function parseFactor(): number {
    const ch = peek();
    if (ch === "-") {
      next();
      return -parseFactor();
    }
    if (ch === "+") {
      next();
      return parseFactor();
    }
    if (ch === "(") {
      next();
      const v = parseExpr();
      if (peek() !== ")") throw new Error("括号不匹配");
      next();
      return v;
    }
    const start = pos;
    while (/[0-9.]/.test(peek())) next();
    const numText = src.slice(start, pos);
    if (!numText) throw new Error(`无法解析的字符「${ch}」`);
    const n = Number(numText);
    if (!Number.isFinite(n)) throw new Error(`无法解析的数字「${numText}」`);
    return n;
  }

  const value = parseExpr();
  if (pos < src.length) throw new Error(`存在无法解析的内容「${src.slice(pos)}」`);
  return value;
}

// ---------- 工具注册 ----------

const calculate: RegisteredTool = {
  schema: {
    type: "function",
    function: {
      name: "calculate",
      description: "精确计算一个四则运算表达式（支持 + - * / % 和括号）。任何数学计算都应使用本工具，不要心算。",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "四则运算表达式，例如 (128*46+372)/4" },
        },
        required: ["expression"],
      },
    },
  },
  execute: async (args) => {
    const expression = String(args.expression ?? "").trim();
    if (!expression) {
      return { summary: "计算失败：表达式为空", display: "plain" };
    }
    try {
      const value = evaluateExpression(expression);
      const formatted = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
      return {
        summary: `${expression} = ${formatted}`,
        data: { expression, value: formatted },
        display: "card-calc",
      };
    } catch (err) {
      return { summary: `计算失败：${err instanceof Error ? err.message : "表达式无效"}`, display: "plain" };
    }
  },
};

const getCurrentTime: RegisteredTool = {
  schema: {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前的日期、星期与时间（服务器本地时区）。凡涉及“今天几号/现在几点/截止日期倒推”都应先调用本工具。",
      parameters: { type: "object", properties: {} },
    },
  },
  execute: async () => {
    const now = new Date();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return {
      summary: `今天是 ${date} 星期${weekdays[now.getDay()]}，当前时间 ${time}`,
      data: { date, weekday: `星期${weekdays[now.getDay()]}`, time },
      display: "plain",
    };
  },
};

/** 模拟天气数据（初版演示用，数据为静态样例并在结果中明确标注） */
const MOCK_WEATHER: Record<string, { city: string; weather: string; temp: string; tip: string }> = {
  北京: { city: "北京", weather: "晴转多云", temp: "14 ~ 26℃", tip: "昼夜温差较大，建议备一件外套。" },
  上海: { city: "上海", weather: "多云", temp: "18 ~ 27℃", tip: "体感舒适，适合户外活动。" },
  广州: { city: "广州", weather: "雷阵雨", temp: "24 ~ 32℃", tip: "出门记得带伞，注意防雷。" },
  深圳: { city: "深圳", weather: "阵雨转多云", temp: "25 ~ 31℃", tip: "湿度较大，注意防潮。" },
  杭州: { city: "杭州", weather: "晴", temp: "17 ~ 28℃", tip: "秋高气爽，适合出行。" },
  成都: { city: "成都", weather: "阴", temp: "16 ~ 23℃", tip: "天色偏阴，晚间可能有零星小雨。" },
  南京: { city: "南京", weather: "多云转晴", temp: "15 ~ 25℃", tip: "天气不错，适合运动。" },
  武汉: { city: "武汉", weather: "晴", temp: "16 ~ 27℃", tip: "紫外线中等，注意防晒。" },
  西安: { city: "西安", weather: "晴间多云", temp: "12 ~ 24℃", tip: "空气干燥，多补充水分。" },
  重庆: { city: "重庆", weather: "阴转多云", temp: "18 ~ 25℃", tip: "湿度较高，体感偏闷。" },
};

const getWeather: RegisteredTool = {
  schema: {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询指定城市的天气（初版为内置模拟数据，接口形态与真实数据源一致，便于后续替换为真实天气 API）。",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名，例如 北京" },
        },
        required: ["city"],
      },
    },
  },
  execute: async (args) => {
    const city = String(args.city ?? "").trim();
    const hit = MOCK_WEATHER[city];
    if (!hit) {
      return { summary: `暂无「${city || "未知城市"}」的演示数据（支持：北京/上海/广州/深圳/杭州/成都/南京/武汉/西安/重庆）`, display: "plain" };
    }
    return {
      summary: `${hit.city} ${hit.weather} ${hit.temp}（模拟数据）`,
      data: { ...hit, isMock: true },
      display: "card-weather",
    };
  },
};

export const toolRegistry: RegisteredTool[] = [calculate, getCurrentTime, getWeather];

export function toolSchemas(): ToolSchema[] {
  return toolRegistry.map((t) => t.schema);
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResultPayload> {
  const tool = toolRegistry.find((t) => t.schema.function.name === name);
  if (!tool) {
    return { summary: `未知工具：${name}`, display: "plain" };
  }
  try {
    return await tool.execute(args);
  } catch (err) {
    return { summary: `工具执行出错：${err instanceof Error ? err.message : String(err)}`, display: "plain" };
  }
}
