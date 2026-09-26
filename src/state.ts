/**
 * 会话内角色状态与每轮注入块。状态随 session entry 持久化（见 index.ts），
 * 本模块只做纯数据处理与渲染。
 */
import type { RpCharacter } from "./card.ts";
import type { RpWorldEntry } from "./worldbook.ts";
import { renderWorldEntries } from "./worldbook.ts";
import { estimateTokens, tokenizeForSearch } from "./text.ts";

export interface RpMemory {
  id: string;
  text: string;
  at: number;
  /** 0–1，越高越不容易被裁掉 */
  importance: number;
  tags: string[];
}

export interface RpSessionState {
  characterId: string;
  /** 当前场景（时间 / 地点 / 局面），由模型通过 rp_state 维护 */
  scene?: string;
  /** 可变剧情状态：位置、衣着、伤势、关系、物品… */
  vars: Record<string, string>;
  memories: RpMemory[];
  greetIndex: number;
  startedAt: number;
  /** 最近一次注入的世界书条目 id，供 /rp inspect 展示 */
  lastWorldIds: string[];
  /** 累计回合数 */
  turns: number;
}

export function createState(characterId: string, now = Date.now()): RpSessionState {
  return { characterId, vars: {}, memories: [], greetIndex: 0, startedAt: now, lastWorldIds: [], turns: 0 };
}

let memorySeq = 0;
let lastMemoryAt = 0;

export function makeMemory(text: string, importance = 0.5, tags: string[] = [], now = Date.now()): RpMemory {
  memorySeq += 1;
  // 同一毫秒内创建的记忆也保持严格递增，保证裁剪与回放顺序确定
  const at = Math.max(now, lastMemoryAt + 1);
  lastMemoryAt = at;
  return {
    id: `m${at.toString(36)}${memorySeq.toString(36)}`,
    text: text.trim(),
    at,
    importance: Math.min(1, Math.max(0, importance)),
    tags,
  };
}

export interface StatePatch {
  scene?: string;
  set?: Record<string, string>;
  unset?: string[];
  note?: string;
}

export interface PatchResult {
  state: RpSessionState;
  /** 实际发生的变更描述，用于工具返回值与 /rp inspect */
  applied: string[];
}

/** 应用一次状态补丁（不可变返回）。角色初始定义与世界 canon 不在可写范围内。 */
export function applyStatePatch(state: RpSessionState, patch: StatePatch): PatchResult {
  const next: RpSessionState = { ...state, vars: { ...state.vars } };
  const applied: string[] = [];

  if (typeof patch.scene === "string" && patch.scene.trim() && patch.scene.trim() !== state.scene) {
    next.scene = patch.scene.trim();
    applied.push(`场景 → ${next.scene}`);
  }

  for (const [rawKey, rawValue] of Object.entries(patch.set ?? {})) {
    const key = rawKey.trim();
    const value = String(rawValue).trim();
    if (!key || !value) continue;
    if (state.vars[key] === value) continue;
    next.vars[key] = value;
    applied.push(`${key} = ${value}`);
  }

  for (const rawKey of patch.unset ?? []) {
    const key = rawKey.trim();
    if (!key || !(key in next.vars)) continue;
    delete next.vars[key];
    applied.push(`${key} 已移除`);
  }

  if (applied.length > 0 && typeof patch.note === "string" && patch.note.trim()) {
    next.memories = trimMemories([...next.memories, makeMemory(patch.note, 0.5)]);
    applied.push("已记入记忆");
  }

  return { state: next, applied };
}

/** 按 importance 降序 + 时间保留最多 max 条记忆。 */
export function trimMemories(memories: readonly RpMemory[], max = 200): RpMemory[] {
  if (memories.length <= max) return [...memories];
  return [...memories]
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, max)
    .sort((a, b) => a.at - b.at);
}

export function forgetMemory(state: RpSessionState, query: string): { state: RpSessionState; removed: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { state, removed: 0 };
  const kept = state.memories.filter((memory) => !memory.text.toLowerCase().includes(needle));
  return { state: { ...state, memories: kept }, removed: state.memories.length - kept.length };
}

/** 朴素关键词召回：命中词元数 + importance 加权。 */
export function recallMemories(state: RpSessionState, query: string, limit = 5): RpMemory[] {
  const tokens = tokenizeForSearch(query);
  if (tokens.length === 0) return [...state.memories].sort((a, b) => b.at - a.at).slice(0, limit);

  return [...state.memories]
    .map((memory) => {
      const haystack = `${memory.text} ${memory.tags.join(" ")}`.toLowerCase();
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      return { memory, hits, score: hits + memory.importance * 0.5 };
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.score - a.score || b.memory.at - a.memory.at)
    .slice(0, limit)
    .map((item) => item.memory);
}

/** 供 /rp status 展示的一行摘要。 */
export function summarizeState(state: RpSessionState): string {
  const varCount = Object.keys(state.vars).length;
  return `场景：${state.scene ?? "（未设定）"} · 状态项 ${varCount} · 记忆 ${state.memories.length} · 回合 ${state.turns}`;
}

export interface TurnContextInput {
  character: RpCharacter;
  state: RpSessionState;
  worldEntries: readonly RpWorldEntry[];
  /** 每轮注入的最近记忆条数（0 = 不注入） */
  memoryLimit: number;
  /** 场景/状态块是否也一起注入 */
  includeState: boolean;
}

/**
 * 渲染每轮追加到最新 user 消息尾部的动态上下文。
 *
 * 为什么不是 system 消息：forced system prompt 生效时 Pi 会把请求里的 system 消息折叠成
 * 一条（`_installAgentForcedPromptProjection`），中途插入的 system 消息会被丢掉。
 * 追加到 user 消息尾部既稳，又不会破坏 system prompt 的缓存前缀。
 */
export function renderTurnContext(input: TurnContextInput): string {
  const blocks: string[] = [];
  const { character, state } = input;

  if (input.includeState) {
    const lines: string[] = [`角色：${character.name}`];
    if (state.scene) lines.push(`场景：${state.scene}`);
    const vars = Object.entries(state.vars);
    if (vars.length > 0) {
      lines.push("当前状态：");
      for (const [key, value] of vars) lines.push(`- ${key}：${value}`);
    } else {
      lines.push("当前状态：（暂无显式条目，按剧情自然推进）");
    }
    blocks.push(`<roleplay_state>\n${lines.join("\n")}\n</roleplay_state>`);
  }

  if (input.memoryLimit > 0 && state.memories.length > 0) {
    const memories = state.memories.slice(-input.memoryLimit);
    const lines = memories.map((memory) => `- ${memory.text}`);
    blocks.push(`<roleplay_memories>\n${lines.join("\n")}\n</roleplay_memories>`);
  }

  const world = renderWorldEntries(input.worldEntries);
  if (world) blocks.push(world);

  if (blocks.length === 0) return "";
  return `<roleplay_context>\n${blocks.join("\n")}\n</roleplay_context>`;
}

/** 估算注入块的 token 量，供 /rp status 与调试输出。 */
export function contextTokens(text: string): number {
  return estimateTokens(text);
}
