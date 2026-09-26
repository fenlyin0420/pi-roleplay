/**
 * RP 专属工具：rp_state / rp_memory / rp_dice。
 * 只依赖注入的 host，不直接碰 session API，方便单测与替换实现。
 */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RpSessionState } from "./state.ts";
import { applyStatePatch, forgetMemory, makeMemory, recallMemories, summarizeState, trimMemories } from "./state.ts";
import { clip } from "./text.ts";

export interface ToolHost {
  /** 角色模式下有值；未激活时工具不应被调用 */
  current(): RpSessionState | undefined;
  /** 持久化新状态 */
  commit(state: RpSessionState, reason: string): void;
  characterName(): string;
  memoryCap(): number;
}

export function registerRoleplayTools(pi: ExtensionAPI, host: ToolHost): void {
  pi.registerTool({
    name: "rp_state",
    label: "RP 状态",
    description:
      "更新当前剧情的可变状态：场景（时间/地点/局面）、状态键值（位置、衣着、伤势、关系、情绪、物品）。只在剧情确实变化时调用，无事发生不要调用。不要用它修改角色初始设定或世界设定。",
    parameters: Type.Object({
      scene: Type.Optional(Type.String({ description: "替换当前场景描述（时间/地点/局面），一句话" })),
      set: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "要设置或覆盖的状态键值，例如 {\"当前位置\":\"王都东门\",\"佩剑\":\"遗失了\"}" })),
      unset: Type.Optional(Type.Array(Type.String(), { description: "要移除的状态键" })),
      note: Type.Optional(Type.String({ description: "需要长期记住的一句话事实（承诺、秘密、关系变化）；琐碎对话不要写" })),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const state = host.current();
      if (!state) return { content: [{ type: "text", text: "当前不在角色模式，忽略。" }], details: {} };

      const patch = params as { scene?: string; set?: Record<string, string>; unset?: string[]; note?: string };
      const { state: next, applied } = applyStatePatch(state, patch);
      if (applied.length === 0) {
        return { content: [{ type: "text", text: "无变化，未写入。" }], details: { applied } };
      }
      host.commit(next, "rp_state");
      return {
        content: [{ type: "text", text: `已更新：${applied.join("；")}\n${summarizeState(next)}` }],
        details: { applied, state: next.vars },
      };
    },
  });

  pi.registerTool({
    name: "rp_memory",
    label: "RP 记忆",
    description:
      "长期记忆：remember 记录值得保留的事实（承诺、秘密、关系变化、伏笔）；recall 按关键词检索；forget 删除匹配项。每轮会自动注入最近若干条记忆，不必反复 recall。",
    parameters: Type.Object({
      op: StringEnum(["remember", "recall", "forget"] as const),
      text: Type.Optional(Type.String({ description: "op=remember 时要记住的事实" })),
      query: Type.Optional(Type.String({ description: "op=recall/forget 时的关键词" })),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "重要度 0–1，默认 0.6；越高越不容易被裁掉" })),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const state = host.current();
      if (!state) return { content: [{ type: "text", text: "当前不在角色模式，忽略。" }], details: {} };
      const { op, text, query, importance } = params as { op: string; text?: string; query?: string; importance?: number };

      if (op === "remember") {
        if (!text?.trim()) return { content: [{ type: "text", text: "缺少 text。" }], details: {} };
        const next: RpSessionState = {
          ...state,
          memories: trimMemories([...state.memories, makeMemory(text, importance ?? 0.6)], host.memoryCap()),
        };
        host.commit(next, "rp_memory");
        return { content: [{ type: "text", text: `已记住（共 ${next.memories.length} 条）：${clip(text.trim(), 120)}` }], details: {} };
      }

      if (op === "forget") {
        if (!query?.trim()) return { content: [{ type: "text", text: "缺少 query。" }], details: {} };
        const result = forgetMemory(state, query);
        if (result.removed > 0) host.commit(result.state, "rp_memory");
        return { content: [{ type: "text", text: `已删除 ${result.removed} 条记忆。` }], details: {} };
      }

      const hits = recallMemories(state, query ?? "", 8);
      if (hits.length === 0) return { content: [{ type: "text", text: "没有匹配的记忆。" }], details: {} };
      const lines = hits.map((memory) => `- ${memory.text}`).join("\n");
      return { content: [{ type: "text", text: `召回 ${hits.length} 条：\n${lines}` }], details: { ids: hits.map((m) => m.id) } };
    },
  });

  pi.registerTool({
    name: "rp_dice",
    label: "RP 骰子",
    description:
      "随机判定：表达式形如 d100、2d6、3d8+2。需要成败、概率或偶然性时用它，不要自己编造随机结果。",
    parameters: Type.Object({
      notation: Type.String({ description: "骰子表达式，例如 d100 / 2d6 / 3d8+2" }),
      reason: Type.Optional(Type.String({ description: "这次判定代表什么（一句话）" })),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const { notation, reason } = params as { notation: string; reason?: string };
      const parsed = rollDice(notation);
      if (!parsed) {
        return { content: [{ type: "text", text: `无法解析骰子表达式：${notation}（支持 d100 / 2d6 / 3d8+2）` }], details: {} };
      }
      const head = reason?.trim() ? `${reason.trim()}：` : "";
      return {
        content: [{ type: "text", text: `${head}${parsed.text}` }],
        details: { rolls: parsed.rolls, total: parsed.total, notation },
      };
    },
  });
}

export interface DiceResult {
  rolls: number[];
  total: number;
  text: string;
}

export function rollDice(
  notation: string,
  random: () => number = Math.random,
  maxDice = 20,
  maxSides = 1000,
): DiceResult | undefined {
  const match = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(notation);
  if (!match) return undefined;

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, "")) : 0;
  if (!Number.isFinite(count) || !Number.isFinite(sides)) return undefined;
  if (count < 1 || count > maxDice) return undefined;
  if (sides < 2 || sides > maxSides) return undefined;

  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
  const detail = count === 1 ? `${rolls[0]}` : `${rolls.join("+")} = ${rolls.reduce((sum, v) => sum + v, 0)}`;
  const text = `${notation.replace(/\s+/g, "")} → ${detail}${modifier ? `${modifier > 0 ? "+" : ""}${modifier}` : ""}，总计 ${total}`;
  return { rolls, total, text };
}
