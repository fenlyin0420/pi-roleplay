/** 插件配置：默认值 ← ~/.pi/agent/roleplay/config.json ← <cwd>/.pi/roleplay/config.json */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RpConfig {
  /** 世界书扫描最近多少条消息（含最新 user 输入） */
  scanDepth: number;
  /** 扫描文本字符上限，避免超长消息吃满匹配开销 */
  scanCharLimit: number;
  /** 每轮世界书注入的 token 预算 */
  worldTokenBudget: number;
  /** 每轮最多注入多少条世界书条目 */
  maxWorldEntries: number;
  /** 每轮注入最近多少条记忆（0 = 不自动注入，只能靠 rp_memory recall） */
  memoryLimit: number;
  /** 记忆总量上限（超出按 importance 裁剪） */
  memoryCap: number;
  /** 进入角色模式是否自动发送开场白 */
  autoGreet: boolean;
  /** 追加到 RP 总纲之后的自定义指令 */
  extraSystemPrompt: string;
  /** 用文件整体替换内置 RP 总纲（相对路径按 roleplay 资产目录解析） */
  systemPromptFile: string;
  /** 世界书条目的默认整词匹配（条目未显式声明时生效） */
  wholeWordDefault: boolean;
}

export const DEFAULT_CONFIG: RpConfig = {
  scanDepth: 4,
  scanCharLimit: 6000,
  worldTokenBudget: 1200,
  maxWorldEntries: 12,
  memoryLimit: 12,
  memoryCap: 200,
  autoGreet: true,
  extraSystemPrompt: "",
  systemPromptFile: "",
  wholeWordDefault: false,
};

function coerce(raw: unknown): Partial<RpConfig> {
  if (typeof raw !== "object" || raw === null) return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<RpConfig> = {};
  const num = (key: keyof RpConfig, min: number, max: number) => {
    const value = input[key as string];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.min(max, Math.max(min, Math.round(value))) as never;
    }
  };
  num("scanDepth", 0, 50);
  num("scanCharLimit", 500, 100_000);
  num("worldTokenBudget", 0, 20_000);
  num("maxWorldEntries", 0, 100);
  num("memoryLimit", 0, 100);
  num("memoryCap", 0, 5000);
  if (typeof input.autoGreet === "boolean") out.autoGreet = input.autoGreet;
  if (typeof input.extraSystemPrompt === "string") out.extraSystemPrompt = input.extraSystemPrompt;
  if (typeof input.systemPromptFile === "string") out.systemPromptFile = input.systemPromptFile;
  if (typeof input.wholeWordDefault === "boolean") out.wholeWordDefault = input.wholeWordDefault;
  return out;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function loadConfig(agentDir: string, cwd: string): { config: RpConfig; sources: string[] } {
  const sources: string[] = [];
  let config = { ...DEFAULT_CONFIG };

  const globalPath = join(agentDir, "roleplay", "config.json");
  if (existsSync(globalPath)) {
    const parsed = coerce(readJson(globalPath));
    if (Object.keys(parsed).length > 0) {
      config = { ...config, ...parsed };
      sources.push(globalPath);
    }
  }

  const projectPath = join(cwd, ".pi", "roleplay", "config.json");
  if (existsSync(projectPath)) {
    const parsed = coerce(readJson(projectPath));
    if (Object.keys(parsed).length > 0) {
      config = { ...config, ...parsed };
      sources.push(projectPath);
    }
  }

  return { config, sources };
}
