import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { characterPersona, parseCharacterFile, parseMarkdownCharacter, parseSillyTavernCharacter, slugify } from "../src/card.ts";
import { isPng, readCharacterJsonFromPng, readPngTextChunks } from "../src/png.ts";

const ST_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "林砚",
    description: "雾港警局外聘法医顾问。",
    personality: "冷静、审慎。",
    scenario: "雨夜，木箱里出现一具骸骨。",
    first_mes: "「你要先听结论，还是先看东西？」",
    alternate_greetings: ["第二条开场白", "第三条开场白"],
    mes_example: "<START>\n{{user}}: 你怎么确定？\n{{char}}: 「现场太干净了。」",
    system_prompt: "台词保持短句。",
    post_history_instructions: "结尾留一个可回应的切口。",
    creator_notes: "示例卡",
    tags: ["悬疑", "推理"],
    character_book: {
      name: "个人书",
      entries: {
        "0": { uid: 0, comment: "旧烫伤", key: ["烫伤"], content: "十岁留下的旧伤。", constant: false, order: 60 },
        "1": { uid: 1, key: [], content: "常驻条目", constant: true, order: 100 },
      },
    },
  },
};

function pngWithText(keyword: string, text: string): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const tEXt = chunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]));
  const compressed = chunk("zTXt", Buffer.concat([Buffer.from("note", "latin1"), Buffer.from([0, 0]), deflateSync(Buffer.from("压缩文本"))]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    tEXt,
    compressed,
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("解析 ST v2 卡的全部字段", () => {
  const character = parseSillyTavernCharacter(ST_V2, { id: "linyan" });
  assert.ok(character);
  assert.equal(character.name, "林砚");
  assert.equal(character.alternateGreetings.length, 2);
  assert.equal(character.tags.join(","), "悬疑,推理");
  assert.equal(character.postHistoryInstructions, "结尾留一个可回应的切口。");
  assert.ok(character.embeddedWorld, "character_book 应被解析成内嵌世界书");
  assert.equal(character.embeddedWorld?.entries.length, 2);
  assert.equal(character.embeddedWorld?.id, "linyan-book");
  assert.ok(characterPersona(character).includes("冷静、审慎。"));
});

test("解析 ST v1 平铺卡", () => {
  const character = parseSillyTavernCharacter(
    { name: "Old", description: "旧格式", first_mes: "你好", personality: "", scenario: "" },
    { id: "old" },
  );
  assert.ok(character);
  assert.equal(character.name, "Old");
  assert.equal(character.firstMes, "你好");
});

test("解析 Markdown 卡与段落映射", () => {
  const text = [
    "---",
    "id: linyan",
    "name: 林砚",
    "world: wugang",
    "tags: [悬疑]",
    "---",
    "# 林砚",
    "",
    "## 核心身份",
    "法医顾问。",
    "",
    "## 外貌",
    "深灰立领外套。",
    "",
    "## 性格",
    "冷静。",
    "",
    "## 开场白",
    "「先听结论还是先看东西？」",
    "",
    "## 备选开场白",
    "第一条",
    "---",
    "第二条",
    "",
    "## 自定义段落",
    "这段会被并入描述。",
  ].join("\n");

  const character = parseMarkdownCharacter(text, { id: "fallback" });
  assert.ok(character);
  assert.equal(character.id, "linyan");
  assert.equal(character.worldId, "wugang");
  assert.ok(character.description.includes("法医顾问。"));
  assert.ok(character.description.includes("深灰立领外套。"));
  assert.ok(character.description.includes("自定义段落"), "未识别段落应并入 description");
  assert.equal(character.personality, "冷静。");
  assert.equal(character.alternateGreetings.length, 2);
});

test("PNG 文本块：tEXt 与 zTXt 都能读", () => {
  const buf = pngWithText("chara", "{\"name\":\"x\"}");
  assert.ok(isPng(buf));
  const chunks = readPngTextChunks(buf);
  assert.equal(chunks.get("chara"), "{\"name\":\"x\"}");
  assert.equal(chunks.get("note"), "压缩文本");
  assert.equal(readCharacterJsonFromPng(buf)?.json, "{\"name\":\"x\"}");
});

test("PNG 卡支持 base64 编码的 v2 JSON 与 ccv3 优先", () => {
  const v2 = Buffer.from(JSON.stringify(ST_V2), "utf8").toString("base64");
  const v3 = { ...ST_V2, spec: "chara_card_v3" } as Record<string, unknown>;
  const buf = Buffer.concat([
    pngWithText("chara", v2),
  ]);
  const parsed = readCharacterJsonFromPng(buf);
  assert.ok(parsed);
  assert.equal(JSON.parse(parsed.json).spec, "chara_card_v2");
  assert.equal(v3.spec, "chara_card_v3");
});

test("parseCharacterFile 自动判定格式", () => {
  const png = parseCharacterFile(pngWithText("chara", Buffer.from(JSON.stringify(ST_V2)).toString("base64")), { id: "linyan" });
  assert.equal(png?.format, "sillytavern-png");
  assert.equal(png?.character.name, "林砚");

  const md = parseCharacterFile(Buffer.from("---\nname: A\n---\n# A\n\n## 开场白\nhi\n"), { id: "a" });
  assert.equal(md?.format, "markdown");

  const broken = parseCharacterFile(Buffer.from("{ not json"), { id: "x" });
  assert.equal(broken, undefined);
});

test("slugify 保留中文、去掉符号", () => {
  assert.equal(slugify("林砚 Linyan!"), "林砚-linyan");
  assert.equal(slugify("!!!"), "character");
});
