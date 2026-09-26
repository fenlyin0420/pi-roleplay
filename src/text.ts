/** 文本度量与匹配工具（纯函数，可单测）。 */

/**
 * 粗略 token 估算：CJK 每个码点算 1 token，其余按 4 字符 1 token。
 * 只用于世界书注入预算与展示，不追求与任何 tokenizer 精确一致。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x2e80) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

/** 按 token 预算截断（不切断代理对），超出时追加省略标记。 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    used += cp >= 0x2e80 ? 1 : 0.25;
    if (used > maxTokens) return `${out.trimEnd()}…`;
    out += ch;
  }
  return out;
}

const REGEX_KEY = /^\/(.+)\/([a-z]*)$/s;

export interface MatchOptions {
  caseSensitive?: boolean;
  /** 仅对 ASCII 关键词生效：要求词边界，避免 "art" 命中 "start"。CJK 永远按子串匹配。 */
  wholeWord?: boolean;
}

/** 单个关键词是否命中。支持 `/regex/flags` 写法。 */
export function keywordMatches(text: string, key: string, options: MatchOptions = {}): boolean {
  const raw = key.trim();
  if (!raw) return false;

  const regexForm = REGEX_KEY.exec(raw);
  if (regexForm) {
    try {
      const flags = options.caseSensitive ? regexForm[2] : `${regexForm[2]}i`.replace("ii", "i");
      return new RegExp(regexForm[1], flags).test(text);
    } catch {
      // 非法正则按普通字符串处理
    }
  }

  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? raw : raw.toLowerCase();

  // 纯 ASCII 关键词 + wholeWord：用词边界；含 CJK 的关键词没有词的概念，退化为子串匹配
  if (options.wholeWord && /^[\x00-\x7f]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, options.caseSensitive ? "" : "i").test(haystack);
  }
  return haystack.includes(needle);
}

/** 稳定去重（保留首次出现顺序）。 */
export function uniqueBy<T, K>(items: readonly T[], keyOf: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 按 CJK/拉丁切分为检索用的词元（供记忆召回做朴素打分）。 */
export function tokenizeForSearch(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens = new Set<string>();
  for (const chunk of lowered.match(/[a-z0-9_]{2,}|[\u3400-\u9fff\u3040-\u30ff]{1,4}/g) ?? []) {
    tokens.add(chunk);
  }
  return [...tokens];
}

/** 截断到字符数，用于展示与日志。 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
