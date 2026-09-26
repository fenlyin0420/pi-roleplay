import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMarkdownWorldEntry,
  parseSillyTavernLorebook,
  renderWorldEntries,
  selectWorldEntries,
  type RpWorldEntry,
} from "../src/worldbook.ts";

const ST_BOOK = {
  name: "雾港",
  description: "世界书",
  entries: {
    "0": { uid: 0, comment: "验尸规程", key: ["验尸", "尸检"], content: "两名在场人员签字。", order: 65 },
    "1": { uid: 1, comment: "煤灰", key: ["煤灰"], keysecondary: ["溺死"], content: "肺内煤灰浓度需核对潮位表。", order: 75 },
    "2": { uid: 2, comment: "基调", key: [], content: "阴湿克制。", constant: true, order: 100 },
    "3": { uid: 3, comment: "已停用", key: ["停用"], content: "不该出现", disable: true, order: 10 },
    "4": { uid: 4, comment: "无关键词", key: [], content: "永远不可能命中", constant: false },
  },
};

test("解析 ST 世界书：字段映射与无效条目过滤", () => {
  const world = parseSillyTavernLorebook(ST_BOOK, "wugang");
  assert.equal(world.name, "雾港");
  // 无关键词且非常驻的条目被丢弃
  assert.equal(world.entries.length, 4);
  const tone = world.entries.find((entry) => entry.id === "wugang-基调");
  assert.ok(tone?.constant);
  assert.equal(tone?.priority, 100);
  const disabled = world.entries.find((entry) => entry.title === "已停用");
  assert.equal(disabled?.disabled, true);
  const secondary = world.entries.find((entry) => entry.title === "煤灰");
  assert.deepEqual(secondary?.secondaryKeys, ["溺死"]);
});

test("解析数组形状与精简形状", () => {
  const arrayShape = parseSillyTavernLorebook({ entries: [{ keys: ["a"], content: "A" }] }, "w");
  assert.equal(arrayShape.entries.length, 1);
  const simple = parseSillyTavernLorebook({ name: "W", entries: [{ id: "x", keys: ["b"], content: "B", priority: 5 }] }, "w");
  assert.equal(simple.entries[0].id, "w-x");
  assert.equal(simple.entries[0].priority, 5);
});

test("解析 markdown 条目", () => {
  const entry = parseMarkdownWorldEntry(
    ["---", "id: districts", "keywords: [码头, 中环]", "priority: 70", "---", "# 三区", "内容"].join("\n"),
    "wugang",
    "fallback",
  );
  assert.ok(entry);
  assert.equal(entry.id, "wugang-districts");
  assert.deepEqual(entry.keys, ["码头", "中环"]);
  assert.equal(entry.priority, 70);
  assert.equal(entry.content, "# 三区\n内容");
});

function entry(partial: Partial<RpWorldEntry> & { id: string }): RpWorldEntry {
  return {
    worldId: "w",
    keys: [],
    secondaryKeys: [],
    content: "内容",
    constant: false,
    priority: 100,
    disabled: false,
    caseSensitive: false,
    wholeWord: false,
    source: "<test>",
    ...partial,
  };
}

test("选条：常驻恒选、关键词命中、priority 降序", () => {
  const entries = [
    entry({ id: "constant", constant: true, priority: 1 }),
    entry({ id: "low", keys: ["码头"], priority: 10 }),
    entry({ id: "high", keys: ["码头"], priority: 90 }),
    entry({ id: "miss", keys: ["太空"] }),
  ];
  const result = selectWorldEntries(entries, { scanText: "他走进码头区" }, { budgetTokens: 1000, maxEntries: 10 });
  assert.deepEqual(result.selected.map((item) => item.id), ["constant", "high", "low"]);
  assert.deepEqual(result.matchedIds, ["high", "low"]);
});

test("选条：次级关键词需要同时命中", () => {
  const entries = [entry({ id: "pair", keys: ["煤灰"], secondaryKeys: ["溺死"] })];
  const hit = selectWorldEntries(entries, { scanText: "肺里有煤灰，疑似溺死" }, { budgetTokens: 1000, maxEntries: 10 });
  assert.equal(hit.selected.length, 1);
  const miss = selectWorldEntries(entries, { scanText: "肺里有煤灰" }, { budgetTokens: 1000, maxEntries: 10 });
  assert.equal(miss.selected.length, 0);
});

test("选条：预算不足时常驻条目被截断、关键词条目整条丢弃", () => {
  const long = "字".repeat(200);
  const entries = [
    entry({ id: "constant", constant: true, priority: 1, content: long }),
    entry({ id: "keyword", keys: ["码头"], priority: 99, content: long }),
  ];
  const result = selectWorldEntries(entries, { scanText: "码头" }, { budgetTokens: 50, maxEntries: 10 });
  assert.deepEqual(result.selected.map((item) => item.id), ["constant"]);
  assert.deepEqual(result.truncatedIds, ["constant"]);
  assert.deepEqual(result.skipped, [{ id: "keyword", reason: "budget" }]);
  assert.ok(result.selected[0].content.length < long.length);
});

test("选条：条目数上限与停用条目", () => {
  const entries = [
    entry({ id: "a", keys: ["x"], priority: 3 }),
    entry({ id: "b", keys: ["x"], priority: 2 }),
    entry({ id: "c", keys: ["x"], priority: 1 }),
    entry({ id: "off", keys: ["x"], disabled: true }),
  ];
  const result = selectWorldEntries(entries, { scanText: "x" }, { budgetTokens: 1000, maxEntries: 2 });
  assert.deepEqual(result.selected.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(result.skipped, [{ id: "c", reason: "max-entries" }]);
});

test("渲染注入块", () => {
  const text = renderWorldEntries([entry({ id: "wugang-tone", title: "基调", constant: true, content: "阴湿克制。" })]);
  assert.ok(text.startsWith("<world_entries>"));
  assert.ok(text.includes('id="wugang-tone"'));
  assert.ok(text.includes("阴湿克制。"));
  assert.equal(renderWorldEntries([]), "");
});
