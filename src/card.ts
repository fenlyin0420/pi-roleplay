/**
 * 角色卡：统一模型 + SillyTavern（v1 / v2 / v3、JSON / PNG）与 Markdown 卡解析。
 * character_book（卡内嵌世界书）会被解析成 RpWorld 挂到角色上。
 */
import { frontmatterList, frontmatterString, parseFrontmatter } from "./markdown.ts";
import { readCharacterJsonFromPng } from "./png.ts";
import { parseSillyTavernLorebook, type RpWorld } from "./worldbook.ts";

export interface RpCharacter {
  id: string;
  name: string;
  /** 身份 / 外貌 / 背景 */
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  alternateGreetings: string[];
  /** 对话示例（ST 的 mes_example，含 <START> 分隔） */
  mesExample: string;
  /** 卡自带 system prompt，注入到 RP 总纲之后 */
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  tags: string[];
  /** 绑定的世界书 id */
  worldId?: string;
  /** 卡内嵌世界书（ST character_book） */
  embeddedWorld?: RpWorld;
  source: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u3400-\u9fff_-]+/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "character"
  );
}

/** ST v2/v3 的 data 段；v1 是平铺在根上的同名字段。 */
function characterData(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const spec = str(raw.spec);
  if (isRecord(raw.data)) return raw.data;
  if (spec.startsWith("chara_card_v")) return {};
  return raw;
}

export interface ParseCharacterOptions {
  id: string;
  source?: string;
}

/** 解析 SillyTavern 角色卡 JSON（v1 平铺 / v2 / v3）。 */
export function parseSillyTavernCharacter(raw: unknown, options: ParseCharacterOptions): RpCharacter | undefined {
  const root = isRecord(raw) ? raw : {};
  const data = characterData(root);
  const name = str(data.name) ?? "";
  if (!name && !str(data.description)) return undefined;

  const id = options.id;
  const source = options.source ?? "<inline>";

  let embeddedWorld: RpWorld | undefined;
  const book = data.character_book;
  if (isRecord(book)) {
    const parsed = parseSillyTavernLorebook(book, `${id}-book`, source);
    if (parsed.entries.length > 0) embeddedWorld = parsed;
  }

  // 世界绑定：SillyTavern 把绑定世界放在 data.extensions.world，也兼容自定义卡里的 world / world_id
  const extensions = isRecord(data.extensions) ? data.extensions : {};
  const worldId =
    str(data.world) ||
    str(data.world_id) ||
    str(extensions.world) ||
    str(extensions.world_name) ||
    undefined;

  return {
    id,
    name: name || id,
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    firstMes: str(data.first_mes),
    alternateGreetings: strList(data.alternate_greetings),
    mesExample: str(data.mes_example),
    systemPrompt: str(data.system_prompt),
    postHistoryInstructions: str(data.post_history_instructions),
    creatorNotes: str(data.creator_notes),
    tags: strList(data.tags),
    worldId,
    embeddedWorld,
    source,
  };
}

const SECTION_TARGETS: Record<string, "description" | "personality" | "scenario" | "firstMes" | "mesExample" | "systemPrompt" | "postHistoryInstructions" | "creatorNotes" | "alternateGreetings"> = {
  核心身份: "description",
  描述: "description",
  背景: "description",
  外貌: "description",
  设定: "description",
  性格: "personality",
  人格: "personality",
  场景: "scenario",
  开场白: "firstMes",
  问候语: "firstMes",
  备选开场白: "alternateGreetings",
  对话示例: "mesExample",
  示例对话: "mesExample",
  系统提示词: "systemPrompt",
  后置指令: "postHistoryInstructions",
  备注: "creatorNotes",
};

/** 解析 Markdown 角色卡：frontmatter + `## 段落`。未识别的段落并入 description。 */
export function parseMarkdownCharacter(text: string, options: ParseCharacterOptions): RpCharacter | undefined {
  const { data, body } = parseFrontmatter(text);
  const id = frontmatterString(data, "id") ?? options.id;
  const source = options.source ?? "<inline>";

  const parts = new Map<string, string[]>();
  const push = (key: string, value: string) => {
    if (!value.trim()) return;
    parts.set(key, [...(parts.get(key) ?? []), value.trim()]);
  };

  const heading = /^#\s+(.+)$/m.exec(body);
  const name = frontmatterString(data, "name") ?? heading?.[1]?.trim() ?? id;

  let current: string | undefined;
  const buffer: string[] = [];
  const flush = () => {
    if (current) push(current, buffer.join("\n"));
    buffer.length = 0;
  };

  for (const line of body.split("\n")) {
    const section = /^##\s+(.+?)\s*$/.exec(line);
    if (section) {
      flush();
      const rawTitle = section[1];
      current = SECTION_TARGETS[rawTitle] ?? "description";
      if (!SECTION_TARGETS[rawTitle]) buffer.push(`## ${rawTitle}`);
      continue;
    }
    if (line.startsWith("# ")) continue; // 角色名标题
    if (current === undefined) continue; // 标题前的散文忽略
    buffer.push(line);
  }
  flush();

  const join = (key: string) => (parts.get(key) ?? []).join("\n\n").trim();
  const alternateRaw = join("alternateGreetings");
  const character: RpCharacter = {
    id,
    name,
    description: join("description"),
    personality: join("personality"),
    scenario: join("scenario"),
    firstMes: join("firstMes"),
    alternateGreetings: alternateRaw
      ? alternateRaw
          .split(/\n\s*---+\s*\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    mesExample: join("mesExample"),
    systemPrompt: join("systemPrompt"),
    postHistoryInstructions: join("postHistoryInstructions"),
    creatorNotes: join("creatorNotes"),
    tags: frontmatterList(data, "tags"),
    worldId: frontmatterString(data, "world") ?? frontmatterString(data, "world_id"),
    source,
  };

  if (!character.description && !character.personality && !character.firstMes) return undefined;
  return character;
}

export interface ParsedCharacterFile {
  character: RpCharacter;
  /** PNG 卡提取出的原始 JSON，便于 `/rp inspect` 展示来源 */
  format: "sillytavern-json" | "sillytavern-png" | "markdown";
}

/** 按文件内容自动判定格式（PNG → JSON → Markdown）。 */
export function parseCharacterFile(buf: Buffer, options: ParseCharacterOptions): ParsedCharacterFile | undefined {
  const fromPng = readCharacterJsonFromPng(buf);
  if (fromPng) {
    try {
      const parsed = parseSillyTavernCharacter(JSON.parse(fromPng.json), {
        id: options.id,
        source: `${options.source ?? "<inline>"}#${fromPng.source}`,
      });
      if (parsed) return { character: parsed, format: "sillytavern-png" };
    } catch {
      return undefined;
    }
  }

  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = parseSillyTavernCharacter(JSON.parse(trimmed), options);
      if (parsed) return { character: parsed, format: "sillytavern-json" };
      return undefined;
    } catch {
      return undefined;
    }
  }

  const parsed = parseMarkdownCharacter(text, options);
  if (parsed) return { character: parsed, format: "markdown" };
  return undefined;
}

/** 卡片自述人格的完整描写，供 system prompt 使用。 */
export function characterPersona(character: RpCharacter): string {
  const sections: string[] = [];
  if (character.description) sections.push(character.description);
  if (character.personality) sections.push(`## 性格\n${character.personality}`);
  return sections.join("\n\n").trim();
}
