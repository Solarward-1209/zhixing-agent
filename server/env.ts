import fs from "node:fs";
import path from "node:path";

/**
 * 极简 .env 读取器（不引入 dotenv 依赖）。
 * 优先级：process.env > 项目根目录 .env 文件。
 */
export function loadProjectEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env");
  const parsed: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        parsed[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env 不存在时静默忽略（演示模式）
  }
  return parsed;
}
