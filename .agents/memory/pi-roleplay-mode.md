---
name: pi-roleplay-mode
description: pi 的角色扮演模式（自研扩展 pi-roleplay）：整套 system prompt 替换、SillyTavern 资产、手机端 tile
metadata:
  type: project
---

**为什么**：用户要 pi 不只是编码 agent，还要能做角色扮演：独立的一套 system prompt、世界书上下文、工具集。
调研过现成包 `@xicode/pi-roleplay@0.5.0`（架构参照，见其评测），但它是「角色卡叠加在编码 prompt 上」且
不收窄工具（编码 prompt 占 system 的 83%，`read/bash/edit/write` 一直暴露），不满足「换掉一套」的要求 → 自研。

**在哪**
- 扩展源码/文档：`~/Documents/GitHub/pi-roleplay/`（`src/index.ts` 主入口；docs/ 下 README、DESIGN、
  FORMAT、ST-COMPAT、EVAL、STATUS、PLAN；tests/ 34 个纯逻辑单测）
- 注册方式：`~/.pi/agent/settings.json` 的 `extensions: ["…/pi-roleplay/src/index.ts"]`（未入戏时惰性）
- 资产：`~/.pi/agent/roleplay/{characters,worlds}`（全局）、`<cwd>/.pi/roleplay/`（项目级覆盖）；
  config.json 调预算；SYSTEM.md 整体替换 RP 总纲
- 手机端 tile：`~/Roleplay` 工作区 + daemon（id `575a466f`，与 Jarvis 并列；改扩展后该 daemon 需重启才生效）

**怎么用**：`/rp use <id>`（`--role <id>` 启动即入戏、`--no-role` 强制不入戏）、`/rp off`、`/rp status`、
`/rp list`、`/rp inspect system|world|state|config`、`/rp greet n`、`/rp ooc <内容>`、`/rp import <文件>`、
`/rp validate`、`/rp init global`；Ctrl+Alt+R 切换。

**手机端**：App 的 `Roleplay` tile 里直接发 `/rp list` / `/rp use <id>` 即可（与 App 同路径的桌面验证命令：
`node ~/.pi/agent/npm/node_modules/remote-pi/dist/index.js daemon send 575a466f "/rp use linyan"`）。
两个坑：① 扩展改动后要 `daemon restart 575a466f` 才生效（别在 Jarvis 会话里重启 Jarvis）；
② **mesh（agent-network）消息不要用来测 slash 命令**——对端收到的是带 envelope 的包装文本，`/rp …` 会被当普通发言；
实测对照：未知命令 `/nonexistent-cmd-xyz` 会新增对话 entry，而 `/rp use` 会写入 `pi-roleplay-mode` entry（= 命令确实被执行）。

**设计要点**（详见 repo docs/DESIGN.md）
- `forceSystemPrompt` 整套替换 → AGENTS.md/skills/docs/cwd 全不进上下文；
- 每轮动态内容（世界书命中 + 状态 + 记忆 + 卡后置指令）追加到**最新 user 消息尾部**；
- 工具集精确收窄到 `rp_state/rp_memory/rp_dice`，每轮重新对齐（别的扩展会装回来），`tool_call` 兜底拦截；
- 状态/模式写 session entry（`pi-roleplay-mode` / `pi-roleplay-state`），`/tree` 与压缩后可从分支恢复；
- 压缩换成剧情向摘要口径。

**边界**：单角色身份（不热切换角色、无群聊）；ST 资产支持 v1/v2/v3 卡 + `chara`/`ccv3` PNG + World Info
JSON，但不支持 `position`/`depth`/`sticky`/递归扫描/向量召回（见 docs/ST-COMPAT.md）。

相关：[[pi-extension-prompt-and-tools]]、[[user-profile]]
