import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { examplesDir, installExamples, loadAssets } from "../src/assets.ts";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-rp-test-"));
}

test("installExamples 不覆盖已有文件，并能被 loadAssets 读出", () => {
  const agentDir = tempDir();
  const cwd = tempDir();
  const root = join(agentDir, "roleplay");

  const first = installExamples(root, examplesDir());
  assert.ok(first.copied.length >= 2);
  assert.equal(first.skipped.length, 0);

  const second = installExamples(root, examplesDir());
  assert.equal(second.copied.length, 0, "第二次安装应全部跳过");
  assert.ok(second.skipped.length >= 2);

  const assets = loadAssets(agentDir, cwd);
  assert.ok(assets.characters.has("linyan"));
  assert.ok(assets.worlds.has("wugang"));
  assert.equal(assets.characters.get("linyan")?.worldId, "wugang");
  assert.ok(assets.worlds.has("linyan-book"), "卡内嵌世界书应单独存在");
  const errors = assets.diagnostics.filter((item) => item.level === "error");
  assert.deepEqual(errors, [], `示例资产不应有错误级别诊断：${JSON.stringify(errors)}`);
});

test("项目级资产覆盖全局同名 id", () => {
  const agentDir = tempDir();
  const cwd = tempDir();
  installExamples(join(agentDir, "roleplay"), examplesDir());

  const projectRoot = join(cwd, ".pi", "roleplay", "characters", "linyan");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    join(projectRoot, "card.json"),
    JSON.stringify({ spec: "chara_card_v2", data: { name: "覆写后的林砚", description: "project override" } }),
  );

  const assets = loadAssets(agentDir, cwd);
  assert.equal(assets.characters.get("linyan")?.name, "覆写后的林砚");
  assert.ok(assets.diagnostics.some((item) => item.code === "character-overridden"));
});

test("坏资产给出分级诊断而不是静默跳过", () => {
  const agentDir = tempDir();
  const cwd = tempDir();
  const root = join(agentDir, "roleplay");

  // 无法解析的卡
  mkdirSync(join(root, "characters", "broken"), { recursive: true });
  writeFileSync(join(root, "characters", "broken", "card.json"), "{ not json");

  // 既非常驻又无关键词的世界条目
  mkdirSync(join(root, "worlds", "w", "entries"), { recursive: true });
  writeFileSync(join(root, "worlds", "w", "WORLD.md"), "---\nname: W\n---\n# W\n描述");
  writeFileSync(join(root, "worlds", "w", "entries", "bad.md"), "---\nid: a\n---\n正文");

  // 角色声明了不存在的世界
  mkdirSync(join(root, "characters", "c"), { recursive: true });
  writeFileSync(
    join(root, "characters", "c", "card.json"),
    JSON.stringify({ data: { name: "C", description: "d", world: "不存在" } }),
  );

  const assets = loadAssets(agentDir, cwd);
  const codes = assets.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("character-unparsable"), codes.join(","));
  assert.ok(codes.includes("world-entry-no-keys"), codes.join(","));
  assert.ok(codes.includes("character-world-missing"), codes.join(","));
  assert.equal(assets.characters.get("c")?.worldId, undefined, "悬空世界引用应被清除");
});

test("config.json 合并：默认 ← 全局 ← 项目，非法值被忽略", () => {
  const agentDir = tempDir();
  const cwd = tempDir();

  mkdirSync(join(agentDir, "roleplay"), { recursive: true });
  writeFileSync(
    join(agentDir, "roleplay", "config.json"),
    JSON.stringify({ worldTokenBudget: 900, scanDepth: 999, autoGreet: false, extraSystemPrompt: "全局" }),
  );
  mkdirSync(join(cwd, ".pi", "roleplay"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "roleplay", "config.json"), JSON.stringify({ memoryLimit: 3, autoGreet: true }));

  const { config, sources } = loadConfig(agentDir, cwd);
  assert.equal(config.worldTokenBudget, 900);
  assert.equal(config.scanDepth, 50, "越界值应被夹到上限");
  assert.equal(config.memoryLimit, 3);
  assert.equal(config.autoGreet, true, "项目级覆盖全局级");
  assert.equal(config.extraSystemPrompt, "全局");
  assert.equal(config.maxWorldEntries, DEFAULT_CONFIG.maxWorldEntries);
  assert.equal(sources.length, 2);
});
