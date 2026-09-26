import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSillyTavernCharacter } from "../src/card.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { applyStatePatch, createState, forgetMemory, makeMemory, recallMemories, renderTurnContext, trimMemories } from "../src/state.ts";
import { parseSillyTavernLorebook } from "../src/worldbook.ts";

const CHARACTER = parseSillyTavernCharacter(
  {
    spec: "chara_card_v2",
    data: {
      name: "林砚",
      description: "雾港警局外聘法医顾问。",
      personality: "冷静、审慎。",
      scenario: "雨夜，木箱里出现一具骸骨。",
      first_mes: "「你要先听结论，还是先看东西？」",
      system_prompt: "台词保持短句。",
      post_history_instructions: "结尾留一个可回应的切口。",
    },
  },
  { id: "linyan" },
)!;

test("状态补丁：设置、清除与记忆", () => {
  let state = createState("linyan");
  const first = applyStatePatch(state, { scene: "东码头·雨夜", set: { 位置: "东码头", 佩剑: "在身" } });
  state = first.state;
  assert.equal(state.scene, "东码头·雨夜");
  assert.deepEqual(state.vars, { 位置: "东码头", 佩剑: "在身" });
  assert.equal(first.applied.length, 3);

  const second = applyStatePatch(state, { set: { 位置: "东码头" }, unset: ["佩剑"], note: "他把佩剑寄放在门房。" });
  assert.deepEqual(second.applied, ["佩剑 已移除", "已记入记忆"]);
  assert.equal(second.state.vars["佩剑"], undefined);
  assert.equal(second.state.memories.length, 1);

  const noop = applyStatePatch(second.state, {});
  assert.deepEqual(noop.applied, []);
});

test("记忆：召回、遗忘与裁剪", () => {
  let state = createState("linyan");
  state = { ...state, memories: [makeMemory("他答应明天还船票给林砚", 0.9), makeMemory("雨停了", 0.1), makeMemory("父亲叫林兆和", 0.7)] };

  const recalled = recallMemories(state, "船票 林砚", 5);
  assert.equal(recalled.length, 1);
  assert.ok(recalled[0].text.includes("船票"));

  const forgotten = forgetMemory(state, "雨停");
  assert.equal(forgotten.removed, 1);
  assert.equal(forgotten.state.memories.length, 2);

  const many = Array.from({ length: 5 }, (_, index) => makeMemory(`第 ${index} 条`, index / 10));
  const trimmed = trimMemories(many, 3);
  assert.equal(trimmed.length, 3);
  assert.deepEqual(trimmed.map((memory) => memory.text), ["第 2 条", "第 3 条", "第 4 条"]);
});

test("每轮注入块：状态 + 记忆 + 世界书，且不含 system 角色暗示", () => {
  const world = parseSillyTavernLorebook(
    { name: "雾港", entries: { "0": { uid: 0, comment: "基调", key: [], content: "阴湿克制。", constant: true } } },
    "wugang",
  );
  let state = createState("linyan");
  state = applyStatePatch(state, { scene: "东码头·雨夜", set: { 位置: "东码头" } }).state;
  state = { ...state, memories: [makeMemory("他说箱子是有人放的", 0.8)] };

  const block = renderTurnContext({
    character: CHARACTER,
    state,
    worldEntries: world.entries,
    memoryLimit: 5,
    includeState: true,
  });

  assert.ok(block.startsWith("<roleplay_context>"));
  assert.ok(block.includes("<roleplay_state>"));
  assert.ok(block.includes("角色：林砚"));
  assert.ok(block.includes("场景：东码头·雨夜"));
  assert.ok(block.includes("- 位置：东码头"));
  assert.ok(block.includes("<roleplay_memories>"));
  assert.ok(block.includes("<world_entries>"));
  assert.ok(block.includes("阴湿克制。"));

  const withoutMemories = renderTurnContext({ character: CHARACTER, state, worldEntries: [], memoryLimit: 0, includeState: false });
  assert.equal(withoutMemories, "");
});

test("RP system prompt：包含角色要素，且不含编码 agent 痕迹", () => {
  const world = parseSillyTavernLorebook({ name: "雾港", description: "低魔港口城市", entries: {} }, "wugang");
  const prompt = buildSystemPrompt({ character: CHARACTER, world, config: DEFAULT_CONFIG });

  assert.ok(prompt.includes("互动小说的叙事引擎"));
  assert.ok(prompt.includes("<character id=\"linyan\" name=\"林砚\">"));
  assert.ok(prompt.includes("雾港警局外聘法医顾问。"));
  assert.ok(prompt.includes("<character_system_prompt>"));
  assert.ok(prompt.includes("台词保持短句。"));
  assert.ok(prompt.includes("<world id=\"wugang\""));
  assert.ok(prompt.includes("rp_state"));
  assert.ok(prompt.includes("(( ))"));

  for (const leak of ["expert coding assistant", "<skills>", "AGENTS.md", "read files", "bash"]) {
    assert.ok(!prompt.includes(leak), `RP prompt 不应包含编码 agent 内容：${leak}`);
  }

  const withExtra = buildSystemPrompt({
    character: CHARACTER,
    config: { ...DEFAULT_CONFIG, extraSystemPrompt: "输出用简体中文。" },
    preambleOverride: "自定义总纲",
  });
  assert.ok(withExtra.startsWith("自定义总纲"));
  assert.ok(withExtra.includes("输出用简体中文。"));
});
