# 进度与状态

最后更新：2026-09-26

## 已完成

| 项 | 状态 | 证据 |
|---|---|---|
| 评测 `@xicode/pi-roleplay` v0.5.0 | ✅ | [EVAL-pi-roleplay.md](EVAL-pi-roleplay.md) + `evidence/pi-roleplay-0.5.0-payload-summary.json` |
| 扩展骨架（模式开关 / flag / 快捷键 / 命令） | ✅ | `src/index.ts` |
| 整套 system prompt 替换 | ✅ | payload 实测：system = 2221 字符 RP 提示词，无编码提示/skills/docs |
| 工具收窄与还原 | ✅ | payload 实测 tools = `rp_state/rp_memory/rp_dice`；非角色模式只有 4 个编码工具 |
| 非模式会话不被污染 | ✅ | 修复"扩展工具默认激活"后实测（README 已验证表 D2 场景） |
| 世界书：ST 兼容解析 + 关键词选条 + 预算裁剪 | ✅ | `src/worldbook.ts` + 9 个单测 + payload 实测命中 |
| 角色卡：ST v1/v2/v3 JSON + PNG（chara/ccv3）+ Markdown | ✅ | `src/card.ts` + `src/png.ts` + 8 个单测 |
| 每轮注入（状态 + 记忆 + 世界书 + 后置指令） | ✅ | payload 实测注入块内容与顺序 |
| 状态/记忆持久化与跨会话恢复 | ✅ | session JSONL 有 `pi-roleplay-mode` / `pi-roleplay-state`；`--session` 恢复后注入块含全部变量 |
| 剧情向压缩 | ✅（代码） | `session_before_compact`；长会话压缩实测待补 |
| 开场白与备选开场白 | ✅ | `autoGreet` + `/rp greet n` |
| `rp_state` / `rp_memory` / `rp_dice` | ✅ | payload 实测 rp_state 被调用并写入状态；rollDice 待加单测 |
| 资产诊断（静默失败对策） | ✅ | `/rp validate` + `session_start` 错误提示 |
| 类型检查 / 单测 | ✅ | `npx tsc --noEmit` 无输出；`node --test` 34/34 通过（含 rollDice、config 合并、资产加载/覆盖/诊断） |
| 文档 | ✅ | README / DESIGN / FORMAT / ST-COMPAT / EVAL / PLAN / 本文件 |
| 注册到真实 pi（含 remote-pi / pi-lens / subagents / mcp 共存） | ✅ | payload 实测 tools = 3 个 RP 工具（修复前会把 `subagent_supervisor`、`mcp` 带进来）|
| `~/Roleplay` 工作区 + daemon | ✅ | `remote-pi daemons` 有 `Roleplay`（pid 466689，running），mesh 可见 |
| 手机通道（与 App 同一条 RPC prompt 路径） | ✅ | `remote-pi daemon send 575a466f "/rp use linyan"` → session 出现 `pi-roleplay-mode` + 开场白 custom message；再发一句剧情指令 → 以林砚口吻回复（命中世界书「码头区」）。对照组：未知命令 `/nonexistent-cmd-xyz` 会被当普通消息（新增对话 entries），证明 `/rp` 确实被当作扩展命令执行 |

## 待办

- [ ] 长会话实测（30+ 回合）：人设漂移、压缩后剧情召回
- [ ] `/rp off` 后工具集还原的最终 payload 实测（目前依据代码路径与 D2 场景）
- [ ] 可选后续：多角色群聊、ST `sticky`/递归扫描、向量召回

## 运维注意

- **改扩展后要重启 daemon 才生效**：`node ~/.pi/agent/npm/node_modules/remote-pi/dist/index.js daemon restart <id>`
  （Roleplay 的 id 是 `575a466f`；千万别在 Jarvis 会话里重启 Jarvis 自己）。
- **从桌面驱动手机那个 tile**：`daemon send <id> "/rp use linyan"`。
- **agent-network 的 mesh 消息不能用来测 slash 命令**：对端收到的是带 envelope 的包装文本，`/rp …`
  会被当成普通发言（App 直发与 `daemon send` 才会走 RPC 的扩展命令分派）。

## 变更记录

- 2026-09-26：初版。评测现成包 → 定架构 → P0/P1 一次做完 → 隔离环境 payload 验证 → 文档。
  过程中修掉 4 个真实问题：
  1. 扩展注册的工具会被 pi 默认激活 → 非角色模式显式摘除；
  2. `--role` 指向不存在的角色时没有回收工具集 → 失败即 stripRpTools；
  3. 内嵌世界书抢占角色的显式世界绑定 → 改为二者并存；
  4. 开场白作为 user 消息会让模型误认成"用户发言" → 加"已发生的开场，非用户发言"标记；
     另外修了记忆召回把 importance 当命中分（导致所有记忆都被召回）与同毫秒记忆排序不确定的问题。
  5. 真实环境（remote-pi + pi-lens + subagents + mcp 共存）里别的扩展会把工具重新装回来
     → 每轮 `before_agent_start` 重新对齐工具集（`enforceRpTools`）。

## 手机通道验证（同日）

- `daemon send` 与 App 直发同走 RPC `prompt`，扩展命令会被分派；用 `remote-pi daemon send 575a466f "/rp use linyan"`
  实测：session 写入 `pi-roleplay-mode`、显示开场白，下一句剧情指令得到入戏回复。
- 对照组：`/nonexistent-cmd-xyz` 被当普通消息（新增对话 entry），说明 `/rp` 确实被当命令执行。
- mesh（agent-network）消息会被包一层 envelope，`/rp …` 不会被分派——测命令别走 mesh。
