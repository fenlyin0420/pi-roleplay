# Architecture

## Request path

```text
CHARACTER.md
  → before_agent_start
  → 角色提示词前置于 Pi 动态 system prompt

WORLD.md + matched entries
  → context
  → 非持久化前置到最新 user message

DeepSeek V4 adapter
  → before_provider_request
  → 最终 payload 第一条 role=user 末尾注入沉浸要求
```

## Why extension, not skill

Skill 是按需能力包，无法保证每轮角色身份都生效。Extension 能覆盖 session、agent 和 provider 生命周期，是人格一致性与模型适配的正确承载层。

## Asset immutability

MVP 将以下资产视为只读 canon：

- `CHARACTER.md`
- `WORLD.md`
- `entries/**/*.md`

插件不会调用 write/edit 改写它们。剧情变化也不回写初始定义。

## Session-first 长会话设计基线

后续研究与实现以 [`SESSION-ROADMAP.md`](SESSION-ROADMAP.md) 为权威路线：

```text
Current Character View
  = Initial Definition
  + Current State
  + Relevant Events
  + Retrieved Memories
  + Lazy World Context
```

核心约束：结构化剧情状态写入 Pi 当前 branch 的 session entry；角色和世界 Markdown 仍是只读初始 canon；运行时只检索相关状态与世界内容；Telemetry 仅负责观测，不作为状态源。历史导航采用 Tree-first：`/tree` 负责同一 Session 内回到过去，`/fork`/`/clone` 负责独立分叉，插件 Correction Commit 只负责当前时间线纠错，不模拟历史撤销。详细规则见 [`SESSION-TREE-INTEGRATION.md`](SESSION-TREE-INTEGRATION.md)。

当前采用单角色 Session Identity：`/rp use <id>` 只在首次角色回复或结构化状态记录之前用于初始化选择；绑定后不能在同一 Session 热切换。Reducer 以绑定的 `characterId` 过滤 Commit、Review、Turn 和 Checkpoint，legacy cross-character entry 保留供审计但不能共享 state/revision。

- `roleplay_finalize_turn` 已实现：模型在最终自然语言回复后通过 schema v2 JSON Tool Call 提交 Event、State Change、Memory 与 Uncertainty；
- 模型状态寻址使用 enum-discriminated `target`（如 `{domain:"appearance", field:"hair.length"}`），Schema 不暴露自由字符串 path；插件确定性生成 canonical path；
- 工具输入必须引用本轮 user/assistant 的精确 evidence quote，插件执行 schema、路径白名单、confidence、revision 与 state hash 校验；
- 接受的 Turn Commit 原子存入 Pi `toolResult.details.roleplayCommit`，精简 XML 存入 tool result content 并参与 Session context；
- Session 恢复或 `/tree` 后，branch reducer 不调用 LLM，直接从 `getBranch()` 的 commits 重建 Current State；fork 后的新扩展实例同样只恢复新 Session 复制到目标节点的 branch；
- Branch summary 可能包含被放弃的另一条时间线；reducer 不从摘要读取状态，角色模式的 `context` hook 还会从瞬时 Provider context 中移除 `branchSummary`，但不修改 Session tree；
- 每轮 `context` 注入 `<roleplay_current_view>`，包含最新 state、按 query/importance/新近度检索的 events 和 memories；Current View 受 `currentState + events + memories` 三个子预算之和约束，世界上下文再取 `contextTotal` 减去 Current View 实际用量后的余额（`contextTotal` 目前只是世界书的上限，不是两者的统一上限，见 [`SESSION-ROADMAP.md`](SESSION-ROADMAP.md)）；
- 当前自动状态白名单仅含 appearance、location、inventory、conditions；relationship、knowledge、goals、questFlags 形成 pending review；
- `/rp review amend` 只覆盖 `value`、`from`、`durability` 并保留原提案；`/rp state correct` 追加带 provenance 的 Correction Commit；
- `/rp event add`、`/rp state set`、`/rp memory add` 提供无 LLM 的显式 branch-local 写入；
- `/rp turn repair` 修复明确标记的 incomplete turn 与 finalize 被整体拒绝的 `finalized-rejected` turn，继续执行同一 evidence Validator；只有真正写入 commit 或 pending review 的修复才算用掉该回合的机会，失败的尝试只留审计记录；
- `agent_settled` 在主模型漏调 finalize 时运行隔离 sidecar；成功结果以
  `pi-roleplay-sidecar` 原子 entry 落盘并复用回合摘要，失败才追加 incomplete 标记；
- finalize 的 inline 调用、主模型漏调和 sidecar 尝试写入 branch-local
  `pi-roleplay-audit`；`/rp status` 提供紧凑指标，`/rp inspect audit` 提供逐条脱敏审计；
- `/rp checkpoint` 追加 hash-verified `pi-roleplay-checkpoint`；reducer 从 branch 上最新有效 checkpoint 开始，只重放后续 Commit；`session_before_compact` / `session_compact` 已以 character、revision、state hash 校验后自动追加无损 branch-local checkpoint；
- validation issue 已结构化区分 schema、evidence、permission、conflict 与 review；
- Checkpoint 记录完整 Commit ID 索引及角色/世界资产 hash；每 50 Commit 自动创建，`/rp archive` 生成完整去重 Event/Memory 归档；
- 内部持久化 schema v2，Reducer 在内存中迁移 v1 Commit/Review/Turn/Checkpoint，不修改旧 Session entry；
- sidecar-on-missing 已通过 `ctx.model`、模型认证和 `complete()` 实现；sidecar custom entry 使用
  `pi.registerEntryRenderer()` 显示与 inline tool 相同的灰色摘要。其他状态类 custom entry 仍通过
  `/rp inspect state` 与 footer 查看。

## Long-session layers

长会话当前已经组合：

```text
Current Character View
  = Initial Definition
  + Current State Snapshot
  + Relevant Events
  + Retrieved Memories
```

当前实现层：

1. **Initial Definition**：Markdown 资产；
2. **Current State**：结构化、可回滚的稀疏覆盖；
3. **Event Log**：追加式客观事件；
4. **Memories**：角色主观记忆与情绪解释。

尚未完成的项目统一记录在 [`SESSION-ROADMAP.md`](SESSION-ROADMAP.md)，本文不再另列一份。

Importer pipeline 以后采用：

```text
JSON / PNG / free text
  → deterministic parser
  → intermediate representation
  → optional LLM normalizer
  → user review
  → Markdown assets
```
