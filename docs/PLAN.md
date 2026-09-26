# 规划（已完成）

> 状态：**已执行完成**。执行结果、验证证据与剩余待办见 [STATUS.md](STATUS.md)；
> 设计与取舍见 [DESIGN.md](DESIGN.md)。以下为确认前的原始规划，保留作为决策记录。

目标：给 pi 增加一个可切换的**角色扮演模式**。该模式下有自己的一整套 system prompt、
世界书/角色卡上下文、专属工具集；编码模式不受任何影响（默认仍是纯编码 agent）。

## 1. 调研结论（事实，非猜测）

### 1.1 pi 扩展 API 能覆盖需求

| 需求 | 机制 | 出处 |
|---|---|---|
| 整套替换 system prompt | `before_agent_start` 返回 `systemPrompt` / `systemPromptOptions.forceSystemPrompt` | docs/extensions.md §before_agent_start |
| 摘掉编码用的 AGENTS.md、skills、自定义 section | 同上，`systemPromptOptions.contextFiles / skills / sections` 可变（就地改） | 同上 |
| 换工具集 | `pi.setActiveTools(names)` / `pi.getActiveTools()` | §pi.getActiveTools |
| 世界书按需注入 | `context` hook（每次 LLM 调用前改消息列表；不会丢 prompt/tools） | §context |
| 模式开关 | `pi.registerCommand` / `registerFlag` / `registerShortcut` | §pi.registerCommand 等 |
| 状态持久化 + 会话恢复 | `pi.appendEntry` + `session_start` / `session_tree` 重放 | plan-mode 示例 |
| 剧情向压缩 | `session_before_compact`（可换模型、自定义摘要提示词） | examples/custom-compaction.ts |
| 手机端（remote-pi）可用 | App 已原生渲染 `extension_ui_request` 的 select/input/confirm；`/rp` 走文本输入即可执行 | app/lib/ui/chat/widgets/extension_ui_sheet.dart |

参考实现：`examples/extensions/plan-mode/`（模式开关 + 工具收窄 + 持久化 + 恢复）、
`preset.ts`（JSON 配置化 preset）、`custom-compaction.ts`、`pirate.ts`（最简 prompt 改写）。

### 1.2 已存在的轮子：`@xicode/pi-roleplay` v0.5.0（MIT，npm，2026-08）

功能：`/rp use|off|init|list|inspect|validate|checkpoint`、`--role/--no-role`、markdown-first 角色卡与
世界书（惰性检索）、`roleplay_finalize_turn` 工具提交 Event/State/Memory、branch-local checkpoint、
session tree 集成、审计、DeepSeek 首条 user 消息适配、E2E 测试齐全。

但**不满足本需求的三点**（已读其 dist 源码确认）：

1. `before_agent_start` 里是 **`角色卡前缀 + "\n\n" + 原 Pi system prompt`**（dist/extension.js:13572）——
   编码 agent 的 prompt、AGENTS.md 上下文全都还在，属于"叠加"而非"替换"。
2. 工具集只增不减：只动态增删 `roleplay_finalize_turn`，`read/bash/edit/write` 始终暴露（:12677）。
3. 每回合可能追加一次隔离的 sidecar LLM 调用（主模型漏调兜底）→ 成本与延迟。
4. 资产是自研 markdown 格式，**不认 SillyTavern 角色卡/世界书**（无 `chara_card_v2` 相关字段）。

结论：**用作架构参照，不自研它的状态机**；最终仍需自研 P0（替换式 prompt + 工具收窄）。

## 2. 推荐架构（三层）

### 2.1 工作区层（隔离）

- 新建 `~/Roleplay` 工作区 + 注册 daemon（`~/.pi/remote/new-agent.sh Roleplay`）：
  - App 里独立 tile、独立 transcript 目录、独立 AGENTS.md（可写成纯 RP 风格）
  - 避免剧情会话和 Jarvis 编码会话混在一个 tile
- 桌面 TUI 可在任意 cwd 用同一个扩展（模式状态按 session 走，不按 cwd）

### 2.2 模式层：自研扩展 `~/.pi/agent/extensions/pi-roleplay/`

- **开关**
  - `/rp on [card]` / `/rp off` / `/rp use <id>` / `/rp status` / `/rp list` / `/rp import <file>` / `/rp validate`
  - `--role <id>` 启动即进入；`/rp off` 后本会话不再自动恢复（照抄 plan-mode 的双重记录：branch entry + 进程内意图）
- **system prompt（核心，与现成包的关键差异）**
  - `forceSystemPrompt = 分层模板`：`RP 总纲(反助手腔/反列表/叙述规范) + 角色卡字段 + 场景与状态 + 世界书说明 + 输出模板 + OOC/记忆协议`
  - 同时清空 `contextFiles`、`skills`、`sections` → 编码 agent 的 AGENTS.md/技能不进入角色上下文
  - 模板与角色卡字段都在资产文件里，可改而不动代码
- **工具集收窄（默认不给编码工具）**
  - RP 集：`rp_state`（场景/关系/物品/情绪，写 branch entry 并可读回）、`rp_memory`（记住/回忆）、`rp_dice`、`rp_ooc`、可选 `rp_summarize`
  - `pi.setActiveTools()` 切换到 RP 集，退出时精确还原切换前的集合（plan-mode 的 `toolsBefore` 模式）
- **世界书**
  - 关键词扫描最近 N 条消息 → 命中条目按 `priority` + token 预算排序注入；常驻条目恒注入；递归扫描可开关
  - 注入位置模拟 ST 的 position/depth（默认靠对话尾部），走 `context` hook
- **角色卡**
  - 支持 SillyTavern `chara_card_v2` JSON 与 PNG（tEXt `chara`/`ccv3` chunk）
  - 字段映射：`description/personality/scenario/first_mes/mes_example/alternate_greetings/system_prompt/post_history_instructions/character_book`
  - `/rp greet [n]` 选择备选开场白
- **持久化与压缩**
  - `pi.appendEntry("pi-roleplay-state", {characterId, scene, mode})`，`session_start`/`session_tree` 恢复
  - `session_before_compact` 换成剧情向摘要提示词（保留人物状态、关系变化、未收束伏笔），避免代码摘要口径
- **展示（仅 `ctx.mode === "tui"` 时启用）**
  - `registerMessageRenderer` 区分正文/旁白/OOC/状态卡；状态栏显示角色名与当前场景

### 2.3 资产层

```
~/.pi/agent/roleplay/
├── characters/<id>/CHARACTER.md|.json  (+ PNG 卡)
├── worlds/<id>/WORLD.md + entries/*.md (或 lorebook JSON)
└── PLAN.md            ← 本文件
```
项目级可覆盖：`<cwd>/.pi/roleplay/`。

## 3. 分期执行

- **P0（MVP，当天可跑）**：`/rp on|off` + `forceSystemPrompt`（含清空 contextFiles/skills）+ 工具收窄与还原
  + JSON 角色卡 + 开场白 + 状态持久化/恢复。
- **P1**：世界书关键词注入与预算、PNG 卡导入、压缩口径、`rp_state`/`rp_memory` 等工具、状态栏与渲染器、`/rp validate`。
- **P2（按需）**：多角色/群聊、备选开场白与重生成、与 Pi 的 subagent/intercom 联动（多角色由不同 agent 扮演）、立绘/TTS。

## 4. 验证方式

1. `/rp on` 后导出当前 system prompt 自检（`/rp inspect` 打印 `ctx.getSystemPrompt()`），确认无编码痕迹。
2. 同一 cwd 开两个会话：RP 会话与编码会话互不污染（prompt、工具集、AGENTS.md）。
3. 手机端：新 tile 里 `/rp use <id>` + 一条开场白走通。
4. 长会话：30+ 回合后人物设定是否漂移；触发压缩后关键剧情是否还在。
5. 单测（vitest/`node --test`）：卡片解析、世界书命中与预算裁剪、模式状态恢复。

## 5. 风险与取舍

- 扩展拥有完整系统权限 → 只加载自己写/审过的代码；npm 包先审再装。
- `forceSystemPrompt` 切换会造成一次 prompt cache miss（仅切换时，可接受）。
- 世界书无预算控制会吃 token → 必须有 token 上限 + 命中上限。
- remote-pi 注册新 daemon 时不得重启现有 Jarvis daemon（见记忆 remote-pi-multi-workspace）。

## 6. 待确认

1. **先花 ~30 分钟实测 `@xicode/pi-roleplay` 再定方案？**（推荐：是，作为参照与备用；但它的"叠加式 prompt + 不收窄工具"不满足需求，最终仍走自研 P0）
2. **只做桌面 TUI，还是同时给手机一个新 tile（`~/Roleplay`）？**（推荐：新建工作区 + daemon，扩展两边共用）
3. **是否要 SillyTavern 兼容（v2 角色卡 + 世界书）？**（推荐：要，可直接用社区卡；自研格式只在需要时补）

附：RP 用哪个模型执行时再定（默认沿用当前会话模型，可加 `/rp model` 切换）。
