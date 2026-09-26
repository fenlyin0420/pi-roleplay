/**
 * 资产加载：角色卡与世界书从磁盘读入内存，并收集诊断信息。
 *
 * 目录约定（项目级覆盖全局级）：
 *   全局：~/.pi/agent/roleplay/
 *   项目：<cwd>/.pi/roleplay/
 *
 *   characters/<id>/card.json | card.png | <id>.json | <id>.md | CHARACTER.md
 *   worlds/<id>/WORLD.md | WORLD.json | <id>.json  (+ 可选 entries/*.md | *.json)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCharacterFile, type RpCharacter } from "./card.ts";
import { parseWorldDescriptor, parseSillyTavernLorebook, parseMarkdownWorldEntry, type RpWorld, type RpWorldEntry } from "./worldbook.ts";

export interface RpDiagnostic {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  fix?: string;
}

export interface RpAssets {
  characters: Map<string, RpCharacter>;
  worlds: Map<string, RpWorld>;
  diagnostics: RpDiagnostic[];
  roots: string[];
}

export function assetRoots(agentDir: string, cwd: string): string[] {
  // 全局在前、项目在后：后加载的同 id 资产覆盖先加载的
  return [join(agentDir, "roleplay"), join(cwd, ".pi", "roleplay")];
}

export function examplesDir(): string {
  return fileURLToPath(new URL("../examples/roleplay", import.meta.url));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function extensionOf(name: string): string {
  return extname(name).toLowerCase();
}

function isAssetFile(name: string): boolean {
  const ext = extensionOf(name);
  return ext === ".json" || ext === ".md" || ext === ".png";
}

function candidateFiles(dir: string, id: string): string[] {
  const names = readdirSync(dir).filter(isAssetFile).sort();
  const pick = (wanted: string[]) => wanted.map((name) => join(dir, name)).filter((path) => existsSync(path));
  return [
    ...pick([`card.json`, `card.png`, `card.md`, `CHARACTER.md`, `${id}.json`, `${id}.png`, `${id}.md`]),
    ...names.map((name) => join(dir, name)).filter((path) => !path.includes("/card.") && !path.includes("/CHARACTER.")),
  ];
}

function resolveCharacterFiles(root: string, diagnostics: RpDiagnostic[]): string[] {
  const dir = join(root, "characters");
  if (!isDirectory(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (isDirectory(path)) {
      const candidates = candidateFiles(path, entry);
      if (candidates.length === 0) {
        diagnostics.push({
          level: "warning",
          code: "character-dir-empty",
          message: `角色目录里没有可解析的卡文件：${path}`,
          path,
          fix: "放入 card.json / card.png / CHARACTER.md 之一，或删掉这个目录",
        });
        continue;
      }
      files.push(candidates[0]);
    } else if (isAssetFile(entry)) {
      files.push(path);
    }
  }
  return files;
}

function loadCharacter(
  path: string,
  diagnostics: RpDiagnostic[],
): { id: string; character: RpCharacter; format: string } | undefined {
  const id = basename(path, extname(path)) === "card" ? basename(dirname(path)) : basename(path, extname(path));
  try {
    const parsed = parseCharacterFile(readFileSync(path), { id, source: path });
    if (!parsed) {
      diagnostics.push({
        level: "warning",
        code: "character-unparsable",
        message: `无法解析角色卡：${path}`,
        path,
        fix: "确认是 SillyTavern v1/v2/v3 JSON、含 chara 块的 PNG，或带 frontmatter 的 Markdown 卡",
      });
      return undefined;
    }
    return { id, character: parsed.character, format: parsed.format };
  } catch (error) {
    diagnostics.push({
      level: "error",
      code: "character-read-failed",
      message: `读取角色卡失败：${path} — ${error instanceof Error ? error.message : String(error)}`,
      path,
    });
    return undefined;
  }
}

function loadWorldsFromDir(dir: string, worldId: string, diagnostics: RpDiagnostic[]): RpWorld | undefined {
  // 世界也可以是单个 JSON 文件（worlds/<id>.json）
  if (!isDirectory(dir)) {
    try {
      const parsed = parseSillyTavernLorebook(JSON.parse(readFileSync(dir, "utf8")), worldId, dir);
      const named = parsed.name === worldId && parsed.entries.length > 0 ? parsed : { ...parsed, name: worldId };
      return { ...named, entries: dedupeEntries(named.entries) };
    } catch (error) {
      diagnostics.push({
        level: "error",
        code: "world-json-invalid",
        message: `世界书 JSON 解析失败：${dir} — ${error instanceof Error ? error.message : String(error)}`,
        path: dir,
      });
      return undefined;
    }
  }

  const descriptorPath = [`WORLD.md`, `WORLD.json`, `${worldId}.md`, `${worldId}.json`]
    .map((name) => join(dir, name))
    .find((path) => existsSync(path));

  let world: RpWorld | undefined;
  if (descriptorPath) {
    const text = readFileSync(descriptorPath, "utf8");
    if (extensionOf(descriptorPath) === ".json") {
      try {
        world = parseSillyTavernLorebook(JSON.parse(text), worldId, descriptorPath);
      } catch (error) {
        diagnostics.push({
          level: "error",
          code: "world-json-invalid",
          message: `世界书 JSON 解析失败：${descriptorPath} — ${error instanceof Error ? error.message : String(error)}`,
          path: descriptorPath,
        });
      }
    } else {
      const descriptor = parseWorldDescriptor(text, worldId);
      world = { id: worldId, name: descriptor.name, description: descriptor.description, entries: [], source: descriptorPath };
    }
  }

  const entriesDir = join(dir, "entries");
  const entries: RpWorldEntry[] = world?.entries ? [...world.entries] : [];

  if (isDirectory(entriesDir)) {
    const walk = (current: string) => {
      for (const entry of readdirSync(current).sort()) {
        const path = join(current, entry);
        if (isDirectory(path)) {
          walk(path);
          continue;
        }
        const ext = extensionOf(entry);
        if (ext === ".md") {
          const parsed = parseMarkdownWorldEntry(readFileSync(path, "utf8"), worldId, basename(entry, ext), path);
          if (parsed) entries.push(parsed);
          else diagnostics.push({ level: "warning", code: "world-entry-empty", message: `世界书条目正文为空：${path}`, path });
        } else if (ext === ".json") {
          try {
            const parsed = parseSillyTavernLorebook(JSON.parse(readFileSync(path, "utf8")), worldId, path);
            entries.push(...parsed.entries);
          } catch (error) {
            diagnostics.push({
              level: "error",
              code: "world-entry-json-invalid",
              message: `世界书条目 JSON 解析失败：${path} — ${error instanceof Error ? error.message : String(error)}`,
              path,
            });
          }
        }
      }
    };
    walk(entriesDir);
  }

  if (!world && entries.length === 0) return undefined;
  const base: RpWorld = world ?? { id: worldId, name: worldId, description: "", entries: [], source: dir };
  const merged: RpWorld = { ...base, entries: dedupeEntries(entries) };
  for (const entry of merged.entries) {
    if (!entry.constant && entry.keys.length === 0) {
      diagnostics.push({
        level: "error",
        code: "world-entry-no-keys",
        message: `条目既非常驻也没有关键词，永远不会被注入：${entry.id}`,
        path: entry.source,
        fix: "补 keywords，或加 constant: true",
      });
    }
  }
  return merged;
}

function dedupeEntries(entries: readonly RpWorldEntry[]): RpWorldEntry[] {
  const seen = new Set<string>();
  const out: RpWorldEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export function loadAssets(agentDir: string, cwd: string): RpAssets {
  const diagnostics: RpDiagnostic[] = [];
  const characters = new Map<string, RpCharacter>();
  const worlds = new Map<string, RpWorld>();
  const roots = assetRoots(agentDir, cwd);

  for (const root of roots) {
    if (!isDirectory(root)) continue;

    for (const file of resolveCharacterFiles(root, diagnostics)) {
      const loaded = loadCharacter(file, diagnostics);
      if (!loaded) continue;
      if (characters.has(loaded.id)) {
        diagnostics.push({
          level: "info",
          code: "character-overridden",
          message: `角色 \"${loaded.id}\" 被更高优先级的资产覆盖（${loaded.character.source}）`,
          path: loaded.character.source,
        });
      }
      characters.set(loaded.id, loaded.character);

      const embedded = loaded.character.embeddedWorld;
      if (embedded) {
        // 卡内嵌世界书单独进资产表（id = <role>-book），不侵占角色显式声明的世界绑定
        const bookId = `${loaded.id}-book`;
        worlds.set(bookId, { ...embedded, id: bookId });
      }
    }

    for (const entry of worldDirs(root, diagnostics)) {
      const world = loadWorldsFromDir(entry.path, entry.id, diagnostics);
      if (!world) {
        diagnostics.push({
          level: "warning",
          code: "world-empty",
          message: `世界里没有任何条目或描述：${entry.path}`,
          path: entry.path,
          fix: "加 WORLD.md 描述，或往 entries/ 放条目",
        });
        continue;
      }
      worlds.set(entry.id, world);
    }
  }

  for (const character of characters.values()) {
    if (character.worldId && !worlds.has(character.worldId)) {
      diagnostics.push({
        level: "warning",
        code: "character-world-missing",
        message: `角色 \"${character.id}\" 绑定的世界 \"${character.worldId}\" 不存在`,
        path: character.source,
        fix: `在 ${roots[1]}/worlds/${character.worldId}/ 建一个 WORLD.md，或把卡的 world 字段去掉`,
      });
      character.worldId = undefined;
    }
  }

  return { characters, worlds, diagnostics, roots };
}

function worldDirs(root: string, diagnostics: RpDiagnostic[]): Array<{ id: string; path: string }> {
  const dir = join(root, "worlds");
  if (!isDirectory(dir)) return [];
  const out: Array<{ id: string; path: string }> = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (isDirectory(path)) out.push({ id: entry, path });
    else if (extensionOf(entry) === ".json") out.push({ id: basename(entry, ".json"), path: join(dir, entry) });
  }
  return out;
}

/** 把包内示例资产装到目标根目录（不覆盖已存在文件）。 */
export function installExamples(targetRoot: string, source = examplesDir()): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];
  if (!isDirectory(source)) return { copied, skipped };

  for (const group of ["characters", "worlds"]) {
    const from = join(source, group);
    if (!isDirectory(from)) continue;
    const to = join(targetRoot, group);
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      const destination = join(to, entry);
      if (existsSync(destination)) {
        skipped.push(destination);
        continue;
      }
      cpSync(join(from, entry), destination, { recursive: true });
      copied.push(destination);
    }
  }
  return { copied, skipped };
}
