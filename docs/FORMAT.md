# 资产格式

资产目录（项目级覆盖全局级同名 id）：

```
~/.pi/agent/roleplay/          # 全局
<cwd>/.pi/roleplay/            # 项目级
├── config.json
├── SYSTEM.md                  # 可选，整体替换内置 RP 总纲
├── characters/
│   ├── <id>/card.json         # SillyTavern v1/v2/v3 JSON
│   ├── <id>/card.png          # 含 chara / ccv3 文本块的 PNG 卡
│   ├── <id>/CHARACTER.md      # Markdown 卡
│   ├── <id>.json | <id>.png | <id>.md
└── worlds/
    ├── <id>/WORLD.md          # 世界描述（正文即设定）
    ├── <id>/WORLD.json        # SillyTavern World Info JSON（含 entries）
    ├── <id>.json              # 单文件世界书
    └── <id>/entries/**/*.md   # 条目：frontmatter + 正文
    └── <id>/entries/**/*.json # 条目：SillyTavern World Info 片段
```

角色 id = 目录名（`card.*` 时）或文件名。同 id 后加载（项目级）覆盖先加载（全局级）。

## 角色卡

优先级：PNG（`ccv3` > `chara`）→ JSON → Markdown。

### SillyTavern JSON

```json
{ "spec": "chara_card_v2", "spec_version": "2.0",
  "data": { "name": "…", "description": "…", "personality": "…", "scenario": "…",
            "first_mes": "…", "alternate_greetings": ["…"], "mes_example": "…",
            "system_prompt": "…", "post_history_instructions": "…",
            "creator_notes": "…", "tags": ["…"],
            "extensions": { "world": "世界 id" },
            "character_book": { "entries": { "0": { "key": [], "content": "…" } } } } }
```

v1（字段平铺在根）同样支持。世界绑定读 `data.world` / `data.world_id` / `data.extensions.world`。

### Markdown 卡

```markdown
---
id: linyan
name: 林砚
world: wugang
tags: [悬疑]
---
# 林砚

## 核心身份
（→ description）
## 性格
（→ personality）
## 场景
（→ scenario）
## 开场白
（→ first_mes）
## 备选开场白
第一条
---
第二条        ← 用 `---` 分隔多条
## 对话示例
（→ mes_example）
## 系统提示词
（→ system_prompt）
## 后置指令
（→ post_history_instructions）
## 备注
（→ creator_notes）
```

未识别的 `##` 段落会并入 description。识别名（中英兼用）：核心身份/描述/背景/外貌/设定、性格/人格、
场景、开场白/问候语、备选开场白、对话示例/示例对话、系统提示词、后置指令、备注。

## 世界书条目（Markdown）

```markdown
---
id: districts
title: 三区地理
keywords: [东码头, 码头区, 中环]
priority: 70          # 越大越优先，默认 100
constant: false       # true = 每轮恒注入
secondary_keywords: [雾]   # 存在时要求与主关键词同时命中
case_sensitive: false
whole_word: false     # 仅对 ASCII 关键词生效
disabled: false
---
条目正文（注入内容，可以是 markdown）
```

- `keywords` 支持 `/正则/flags` 写法；
- 既没有 `keywords` 又 `constant: false` 的条目永远不会命中，`/rp validate` 会报 error。

## 世界书 JSON

SillyTavern World Info 的三种形状都接受：

```json
// 1) ST 导出（对象键为 uid）
{ "entries": { "0": { "uid": 0, "key": ["码头"], "keysecondary": ["雾"], "comment": "标题",
                      "content": "正文", "constant": false, "order": 70, "disable": false } } }
// 2) 数组
{ "entries": [ { "keys": ["码头"], "content": "正文" } ] }
// 3) 精简
{ "name": "雾港", "entries": [ { "id": "x", "keys": ["码头"], "content": "正文", "priority": 70 } ] }
```

字段别名：`key`/`keys`/`keywords`、`keysecondary`/`secondaryKeys`、`comment`/`title`/`name`、
`order`/`priority`、`disable`/`disabled`。条目 id 生成为 `<worldId>-<slug>`。

## config.json

见 README 的配置表。非法值（越界数字、非布尔）按默认值处理，不报错。

## SYSTEM.md

存在时整体替换内置 RP 总纲（preamble），其余分层（角色卡、世界、卡自带 system prompt、每轮注入块）
照常拼接。查找顺序：`<cwd>/.pi/roleplay/SYSTEM.md` → `~/.pi/agent/roleplay/SYSTEM.md`。
