/**
 * 世界书：条目模型、SillyTavern 兼容解析、按关键词选条与 token 预算裁剪。
 * 全部为纯函数，便于单测；文件读取在 assets.ts。
 */
import { frontmatterBool, frontmatterList, frontmatterNumber, frontmatterString, parseFrontmatter } from "./markdown.ts";
import { estimateTokens, keywordMatches, truncateToTokens, uniqueBy } from "./text.ts";

export interface RpWorldEntry {
  /** 条目唯一 id（全局唯一：`<worldId>-<slug>` 或 ST uid） */
  id: string;
  worldId: string;
  title?: string;
  keys: string[];
  /** 次级关键词：存在时要求同时命中（ST 的 selective 逻辑） */
  secondaryKeys: string[];
  content: string;
  /** true = 常驻，不需关键词命中 */
  constant: boolean;
  /** 越大越优先（ST 的 order） */
  priority: number;
  disabled: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  source: string;
}

export interface RpWorld {
  id: string;
  name: string;
  description: string;
  entries: RpWorldEntry[];
  source: string;
}

export interface SelectOptions {
  budgetTokens: number;
  maxEntries: number;
}

export interface SelectionResult {
  /** 最终注入的条目（常驻在前，其余按 priority 降序） */
  selected: RpWorldEntry[];
  /** 因预算或条目数上限被丢弃的条目 */
  skipped: Array<{ id: string; reason: "budget" | "max-entries" }>;
  matchedIds: string[];
  usedTokens: number;
  /** 常驻条目本身超出预算时被截断 */
  truncatedIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  const single = readString(value);
  return single ? [single] : [];
}

function slug(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, 48) || "entry";
}

/**
 * 解析 SillyTavern 世界书 JSON。兼容三种形状：
 * 1. ST 导出：`{ entries: { "0": { key: [...], content, constant, order, ... } } }`
 * 2. 数组形状：`{ entries: [ { keys: [...], content } ] }`
 * 3. 精简形状：`{ name, description, entries: [ { id, keys, content, constant, priority } ] }`
 */
export function parseSillyTavernLorebook(raw: unknown, worldId: string, source = "<inline>"): RpWorld {
  const root = isRecord(raw) ? raw : {};
  const name = readString(root.name) ?? readString(root.world) ?? worldId;
  const description = readString(root.description) ?? readString(root.desc) ?? "";
  const rawEntries = root.entries;
  const list: Array<{ key: string; value: Record<string, unknown> }> = [];

  if (Array.isArray(rawEntries)) {
    rawEntries.forEach((value, index) => {
      if (isRecord(value)) list.push({ key: String(value.uid ?? value.id ?? index), value });
    });
  } else if (isRecord(rawEntries)) {
    for (const [key, value] of Object.entries(rawEntries)) {
      if (isRecord(value)) list.push({ key, value });
    }
  }

  const entries: RpWorldEntry[] = [];
  for (const { key, value } of list) {
    const content = readString(value.content);
    if (!content) continue;
    const keys = uniqueBy(
      [...readStringArray(value.key), ...readStringArray(value.keys), ...readStringArray(value.keywords)],
      (item) => item,
    );
    const secondaryKeys = uniqueBy(
      [...readStringArray(value.keysecondary), ...readStringArray(value.secondaryKeys)],
      (item) => item,
    );
    const title = readString(value.comment) ?? readString(value.title) ?? readString(value.name);
    const constant = value.constant === true;
    if (!constant && keys.length === 0) continue; // 无关键词又非常驻的条目永远不会命中，直接忽略

    const priorityRaw = value.order ?? value.priority ?? value.insertionOrder;
    const priority = typeof priorityRaw === "number" && Number.isFinite(priorityRaw) ? priorityRaw : 100;

    const idBase = readString(value.id) ?? title ?? key;
    entries.push({
      id: `${worldId}-${slug(idBase)}`,
      worldId,
      title,
      keys,
      secondaryKeys,
      content,
      constant,
      priority,
      disabled: value.disable === true || value.disabled === true || value.enabled === false,
      caseSensitive: value.caseSensitive === true,
      wholeWord: value.matchWholeWords === true,
      source,
    });
  }

  return { id: worldId, name, description, entries, source };
}

/** 解析 markdown 条目（frontmatter + 正文）。 */
export function parseMarkdownWorldEntry(text: string, worldId: string, fallbackId: string, source = "<inline>"): RpWorldEntry | undefined {
  const { data, body } = parseFrontmatter(text);
  const content = body.trim();
  if (!content) return undefined;

  const keys = uniqueBy(
    [...frontmatterList(data, "keywords"), ...frontmatterList(data, "keys"), ...frontmatterList(data, "key")],
    (item) => item,
  );
  const constant = frontmatterBool(data, "constant") ?? false;
  const idBase = frontmatterString(data, "id") ?? fallbackId;

  return {
    id: `${worldId}-${slug(idBase)}`,
    worldId,
    title: frontmatterString(data, "title") ?? idBase,
    keys,
    secondaryKeys: frontmatterList(data, "secondary_keywords"),
    content,
    constant,
    priority: frontmatterNumber(data, "priority") ?? 100,
    disabled: frontmatterBool(data, "disabled") ?? false,
    caseSensitive: frontmatterBool(data, "case_sensitive") ?? false,
    wholeWord: frontmatterBool(data, "whole_word") ?? false,
    source,
  };
}

/** 解析世界入口描述文件（WORLD.md / WORLD.json 里的 name/description）。 */
export function parseWorldDescriptor(text: string, worldId: string): Pick<RpWorld, "name" | "description"> {
  const { data, body } = parseFrontmatter(text);
  const heading = /^#\s+(.+)$/m.exec(body);
  return {
    name: frontmatterString(data, "name") ?? heading?.[1]?.trim() ?? worldId,
    description: body.trim(),
  };
}

function entryMatches(entry: RpWorldEntry, scanText: string): boolean {
  if (entry.keys.length === 0) return false;
  const options = { caseSensitive: entry.caseSensitive, wholeWord: entry.wholeWord };
  const primary = entry.keys.some((key) => keywordMatches(scanText, key, options));
  if (!primary) return false;
  if (entry.secondaryKeys.length === 0) return true;
  return entry.secondaryKeys.some((key) => keywordMatches(scanText, key, options));
}

export interface SelectContext {
  /** 最近的对话文本（已拼接） */
  scanText: string;
}

/**
 * 选出本轮要注入的世界书条目。
 * 规则：常驻条目恒选（必要时截断），其余按关键词命中 + priority 降序，
 * 直到条目数上限或 token 预算耗尽。
 */
export function selectWorldEntries(
  entries: readonly RpWorldEntry[],
  context: SelectContext,
  options: SelectOptions,
): SelectionResult {
  const enabled = entries.filter((entry) => !entry.disabled);
  const constants = enabled
    .filter((entry) => entry.constant)
    .sort((a, b) => b.priority - a.priority);

  const matched = enabled
    .filter((entry) => !entry.constant && entryMatches(entry, context.scanText))
    .sort((a, b) => b.priority - a.priority);

  const selected: RpWorldEntry[] = [];
  const skipped: SelectionResult["skipped"] = [];
  const truncatedIds: string[] = [];
  let usedTokens = 0;

  const budget = Math.max(0, options.budgetTokens);

  for (const entry of [...constants, ...matched]) {
    if (selected.length >= options.maxEntries) {
      skipped.push({ id: entry.id, reason: "max-entries" });
      continue;
    }
    const entryTokens = estimateTokens(entry.content);
    const remaining = budget - usedTokens;

    if (remaining <= 0) {
      skipped.push({ id: entry.id, reason: "budget" });
      continue;
    }

    if (entryTokens <= remaining) {
      selected.push(entry);
      usedTokens += entryTokens;
      continue;
    }

    // 预算不够：常驻条目截断保留（丢了等于人设缺一块），关键词条目整条丢弃（半截信息更容易误导模型）
    if (entry.constant) {
      selected.push({ ...entry, content: truncateToTokens(entry.content, remaining) });
      truncatedIds.push(entry.id);
      usedTokens = budget;
      continue;
    }
    skipped.push({ id: entry.id, reason: "budget" });
  }

  return {
    selected,
    skipped,
    matchedIds: matched.map((entry) => entry.id),
    usedTokens,
    truncatedIds,
  };
}

/** 把选中的条目渲染成注入用文本块。 */
export function renderWorldEntries(selected: readonly RpWorldEntry[]): string {
  if (selected.length === 0) return "";
  const body = selected
    .map((entry) => {
      const title = entry.title ? ` title="${entry.title.replace(/"/g, "'")}"` : "";
      return `<world_entry world="${entry.worldId}" id="${entry.id}"${title}>\n${entry.content}\n</world_entry>`;
    })
    .join("\n");
  return `<world_entries>\n${body}\n</world_entries>`;
}
