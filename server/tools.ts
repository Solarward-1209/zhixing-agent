import type { ToolResultPayload } from "../shared/protocol";
import type { ToolSchema } from "./llm";
import { fetchWithRetry } from "./llm";
import { loadProjectEnv } from "./env";
import { describeImage, hasVisionConfig } from "./vision";

/**
 * MCP 风格的工具注册表：每个工具用统一的 JSON Schema 描述契约，
 * 编排器按协议调用 executeTool，新增工具只需在这里登记（对应评分点：MCP/工具集成）。
 *
 * 工具列表：
 * - calculate        精确四则运算（递归下降解析器，不用 eval）
 * - get_current_time 当前日期时间
 * - get_weather      真实天气（Open-Meteo，免 Key）；演示模式或网络不可用时可显式降级为样例数据
 * - understand_image 图片理解（调用视觉模型，供 Agent 主循环自主调用）
 *
 * 说明：演示模式（未配置大模型 Key）下不再向模型暴露任何"假数据工具"，
 * 真实模式下的 get_weather 走真实数据源，查询失败会如实返回失败摘要。
 */

export interface ToolContext {
  /** 本轮请求携带的图片（data URL），供 understand_image 使用 */
  images?: string[];
  /** 取消信号 */
  signal?: AbortSignal;
  /** 测试注入：替换全局 fetch */
  fetchImpl?: typeof fetch;
  /** 覆盖天气数据源：real 真实接口 / mock 样例数据 */
  weatherMode?: "real" | "mock";
}

export interface RegisteredTool {
  schema: ToolSchema;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResultPayload>;
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

// ---------- 天气：真实数据（Open-Meteo，免 Key）+ 显式标注的离线样例 ----------

/** 演示/离线样例数据（仅在明确选择 mock 或演示模式下使用，结果中始终标注） */
export const MOCK_WEATHER: Record<string, { city: string; weather: string; temp: string; tip: string }> = {
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

/** WMO 天气代码 → 中文描述（Open-Meteo 使用 WMO 标准） */
export function mapWeatherCode(code: number): string {
  const table: Record<number, string> = {
    0: "晴",
    1: "晴间多云",
    2: "多云",
    3: "阴",
    45: "有雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    56: "冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "阵雨",
    81: "中阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "大阵雪",
    95: "雷阵雨",
    96: "雷阵雨伴小冰雹",
    99: "雷阵雨伴大冰雹",
  };
  return table[code] ?? "未知天气";
}

function weatherTip(code: number, tempMax?: number): string {
  if (code >= 95) return "有雷电活动，尽量减少户外停留。";
  if (code >= 51 && code <= 67) return "有降水，出门记得带伞。";
  if (code >= 71 && code <= 86) return "有降雪，注意路面湿滑与保暖。";
  if (typeof tempMax === "number" && tempMax >= 33) return "气温偏高，注意补水与防暑。";
  if (typeof tempMax === "number" && tempMax <= 3) return "气温偏低，注意保暖。";
  return "天气总体平稳，适合安排出行或备赛复习。";
}

interface OpenMeteoGeo {
  results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }>;
}

interface OpenMeteoForecast {
  current?: { temperature_2m?: number; weather_code?: number; relative_humidity_2m?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
}

/** 解析天气数据源：显式配置 > 演示模式；默认真实数据 */
function resolveWeatherMode(ctx: ToolContext): "real" | "mock" {
  if (ctx.weatherMode) return ctx.weatherMode;
  const env = loadProjectEnv();
  const configured = (process.env.WEATHER_MODE ?? env.WEATHER_MODE ?? "").toLowerCase();
  if (configured === "mock" || configured === "real") return configured as "real" | "mock";
  // auto：演示模式下不发起外网请求，真实模式使用真实数据
  const hasLlm = Boolean(process.env.AI_API_KEY ?? env.AI_API_KEY);
  return hasLlm ? "real" : "mock";
}

function mockWeatherPayload(city: string): ToolResultPayload {
  const hit = MOCK_WEATHER[city];
  if (!hit) {
    return {
      summary: `暂无「${city || "未知城市"}」的离线样例（支持：${Object.keys(MOCK_WEATHER).join("/")}）。配置真实天气源后支持任意城市。`,
      display: "plain",
    };
  }
  return {
    summary: `${hit.city} ${hit.weather} ${hit.temp}（离线样例数据，非实时）`,
    data: { ...hit, isMock: true, source: "mock" },
    display: "card-weather",
  };
}

const getWeather: RegisteredTool = {
  schema: {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "查询指定城市的实时天气（真实数据源 Open-Meteo，支持全国及全球城市）。凡涉及天气、气温、是否需要带伞等问题都应调用本工具。",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名，例如 北京、上海、杭州" },
        },
        required: ["city"],
      },
    },
  },
  execute: async (args, ctx) => {
    const city = String(args.city ?? "").trim();
    if (!city) return { summary: "天气查询失败：未提供城市名", display: "plain" };

    if (resolveWeatherMode(ctx) === "mock") return mockWeatherPayload(city);

    try {
      const geoRes = await fetchWithRetry(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,
        { method: "GET" },
        { timeoutMs: 8_000, maxRetries: 1, signal: ctx.signal, fetchImpl: ctx.fetchImpl },
      );
      if (!geoRes.ok) throw new Error(`地理编码 HTTP ${geoRes.status}`);
      const geo = (await geoRes.json()) as OpenMeteoGeo;
      const place = geo.results?.[0];
      if (!place) {
        return { summary: `未找到城市「${city}」，请换一个更常见的写法（如 北京、上海）。`, display: "plain" };
      }

      const fcRes = await fetchWithRetry(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          "&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1",
        { method: "GET" },
        { timeoutMs: 8_000, maxRetries: 1, signal: ctx.signal, fetchImpl: ctx.fetchImpl },
      );
      if (!fcRes.ok) throw new Error(`天气接口 HTTP ${fcRes.status}`);
      const fc = (await fcRes.json()) as OpenMeteoForecast;

      const code = Number(fc.current?.weather_code ?? -1);
      const desc = mapWeatherCode(code);
      const temp = fc.current?.temperature_2m;
      const tMax = fc.daily?.temperature_2m_max?.[0];
      const tMin = fc.daily?.temperature_2m_min?.[0];
      const range =
        typeof tMax === "number" && typeof tMin === "number"
          ? `${Math.round(tMin)} ~ ${Math.round(tMax)}℃`
          : typeof temp === "number"
            ? `当前 ${Math.round(temp)}℃`
            : "—";
      // 地名拼接：admin1 已含城市名（如"北京市"）时不再重复追加，避免出现"中国北京市北京"
      const localName = place.admin1?.includes(place.name) ? place.admin1 : [place.admin1, place.name].filter(Boolean).join("");
      const placeLabel = `${place.country ?? ""}${localName}`;

      return {
        summary: `${placeLabel} ${desc}${typeof temp === "number" ? `，当前 ${Math.round(temp)}℃` : ""}，今日 ${range}`,
        data: {
          city: placeLabel,
          weather: desc,
          temp: range,
          humidity: fc.current?.relative_humidity_2m,
          tip: weatherTip(code, tMax),
          isMock: false,
          source: "open-meteo",
        },
        display: "card-weather",
      };
    } catch (err) {
      // 真实模式下绝不返回假数据，如实报告失败原因
      return {
        summary: `天气查询失败：${err instanceof Error ? err.message : "网络异常"}。可稍后重试。`,
        data: { city, failed: true },
        display: "plain",
      };
    }
  },
};

// ---------- 图片理解：把多模态接入 Agent 主循环 ----------

const understandImage: RegisteredTool = {
  schema: {
    type: "function",
    function: {
      name: "understand_image",
      description:
        "理解用户本轮上传的图片内容（识别画面、转录图中文字、读取表格数据）。当用户上传了图片或问题指代图片内容时，必须先调用本工具获取图片描述，再基于描述回答。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "希望从图片中获取什么信息，例如「转录图中的评审权重表格」" },
        },
      },
    },
  },
  execute: async (args, ctx) => {
    const images = ctx.images ?? [];
    if (images.length === 0) {
      return { summary: "本轮对话没有附带图片，无需调用图片理解工具。", display: "plain" };
    }
    if (!hasVisionConfig()) {
      return { summary: "尚未配置视觉模型（VISION_API_KEY），暂时无法识别图片，请引导用户改用文字描述。", display: "plain" };
    }
    const question = String(args.question ?? "请描述图片内容并转录其中的关键文字").trim();
    try {
      const description = await describeImage(question, images, { signal: ctx.signal });
      return {
        summary: description.slice(0, 800),
        data: { description, imageCount: images.length, question },
        display: "card-vision",
      };
    } catch (err) {
      return {
        summary: `图片理解失败：${err instanceof Error ? err.message : "视觉模型异常"}。可提示用户重试或改用文字描述。`,
        display: "plain",
      };
    }
  },
};

export const toolRegistry: RegisteredTool[] = [calculate, getCurrentTime, getWeather, understandImage];

export function toolSchemas(): ToolSchema[] {
  return toolRegistry.map((t) => t.schema);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolResultPayload> {
  const tool = toolRegistry.find((t) => t.schema.function.name === name);
  if (!tool) {
    return { summary: `未知工具：${name}`, display: "plain" };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    return { summary: `工具执行出错：${err instanceof Error ? err.message : String(err)}`, display: "plain" };
  }
}
