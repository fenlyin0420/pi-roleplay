# Markdown Asset Format v1

> 改完资产后运行 `/rp validate` 做一次显式校验：它会按错误 / 警告 / 提示分级列出下文所有约束的
> 违反情况，并给出具体文件路径和修复动作。不带参数检查全部资产，`/rp validate <角色 id>` 只检查
> 那张卡及其关联世界。

## 文件编码与分隔符

- **文件必须是 UTF-8。BOM 会被自动剥离**，但仍然建议保存为「UTF-8 无 BOM」。历史上 BOM 会让
  `startsWith("---")` 判定失败，导致整块 frontmatter 被当成正文注入 system prompt；这一点已经修复，
  但 BOM 仍会污染 diff 与部分外部工具。
- frontmatter 必须由**单独成行**的 `---` 开头和结尾。只写开头不写结尾时 YAML 不会报错，而是整块被
  当作正文——`id` 回落成目录名、`worlds` 变成空数组、`budgets` 全部回到默认值、`examples` 丢失。
  加载器现在会为这种情况报错并指出文件路径。
- 换行符 CRLF 与 LF 均可，加载时会统一归一化。

## id 唯一性

| 资产 | 默认 id | 冲突后果 |
| --- | --- | --- |
| 角色卡 | 所在目录名 | 后加载的覆盖先加载的，先加载的卡不出现在 `/rp list`，正文也不会注入 |
| 世界书 | 所在目录名 | 同上 |
| 世界条目 | 文件名（去掉 `.md`），例如 `guard` | 同一世界内的同 id 条目会被报告；检索只保留其中分数最高的一条 |

- **同一根目录内出现重复 id 一定是错误**，加载器会报错并同时给出两个文件路径以及哪一个生效。
  复制示例卡后忘记改 `id:` 是最常见的诱因。
- **跨根目录的同 id 是受支持的覆盖**：受信任的项目资产覆盖全局资产。这不会告警，但会在
  `/rp validate` 的「提示」一节里列出覆盖关系。
- 世界条目的默认 id 保持历史上的文件名语义，以免升级后仅因目录布局而改变既有 Checkpoint 的资产
  快照。`entries/npc/guard.md` 与 `entries/rules/guard.md` 会冲突，加载器会报告双方路径；请显式声明
  不同的 `id:`。不同世界里的条目 id 是各世界的局部标识，可以合法复用。

## 非资产目录

`characters/` 与 `worlds/` 下缺少入口文件的子目录会被报错——那通常意味着一份写坏的资产。为了不把
分组目录和工具残留也算进去，以下目录会被直接跳过，不产生任何诊断：

- 名字以 `.` 或 `_` 开头的目录（`.git`、`.obsidian`、`.stfolder`、`_templates`、`_wip`）；
- `node_modules`；
- **任何递归下去都不含 `.md` 的目录**（`@eaDir`、缩略图目录、还没开始写的空目录）。

想让一个分组目录彻底安静下来，给它加个 `_` 前缀即可。

## `spec` 字段的现状

三类资产的 frontmatter 都以 `spec:` 开头，但它是**保留字段，当前不参与任何校验**。loader
（`src/assets.ts`）从不读取 `spec`：写成 `@2`、写成别的字符串或完全省略，加载结果完全相同，也不会
产生 diagnostics。`src/types.ts` 中的 `CHARACTER_SPEC` / `WORLD_SPEC` / `WORLD_ENTRY_SPEC` 常量目前
没有任何调用点。

保留它是为了给未来的格式版本检查和 importer 留出位置。新建资产时**建议照写**下文示例中的值，以便将来
启用校验时无需迁移；但不要依赖它做兼容性判断——现在没有任何代码会因为 `spec` 不匹配而拒绝加载资产。

## Character

文件名必须为 `CHARACTER.md`：

```markdown
---
spec: pi-roleplay/character@1
id: alice
name: 爱丽丝
description: 用于发现和列表的简短描述
default: true
language: zh-CN
worlds: [astra]
tags: [fantasy]
examples: examples.md
budgets:
  examples: 1000
  worldCore: 2500
  worldEntries: 5000
  contextTotal: 9000
  currentState: 2500
  events: 1000
  memories: 1200
  maxEntries: 8
  recentMessages: 6
models:
  deepseekV4FirstUserImmersion: true
---

# 角色名

在 Markdown 正文中自由描述身份、外貌、性格、语言、知识边界和扮演原则。
```

`frontmatter` 只用于发现、路由、预算和模型适配。年龄、发色等初始属性建议写入正文，不会自动变化。

### `worlds`

`worlds` 里的每一项都必须精确等于某个世界书的 `id`（即 `worlds/<dir>/WORLD.md` 中的 `id:`，缺省时为
目录名）。**拼错一个字母不会报错，世界书会全程不生效**：核心正文不注入、条目不参与检索。加载器现在
会为未解析的引用报错并给出最接近的候选，`/rp status` 与 `/rp inspect world` 也会逐个标注解析状态：

```text
世界：astra ✓(3 条目) / astara ✗(未找到)
```

### `budgets` 的合法取值

所有预算都是**近似 token 数**（按 4 字符 ≈ 1 token 估算），只有 `maxEntries` 和 `recentMessages` 是条数。
世界条目在启动扫描时先用文件大小做惰性估算，实际命中和 `/rp validate` 时会改用 Markdown 正文长度，
不会把 frontmatter 计入注入预算。

| 键 | 默认值 | 含义 | 设为 0 的**实际**后果 |
| --- | --- | --- | --- |
| `examples` | 1500 | 对话示例注入上限 | 示例被截成空串，`<roleplay_examples>` 整段消失 |
| `worldCore` | 2500 | `WORLD.md` 正文注入上限 | 世界核心正文不再注入 |
| `worldEntries` | 5000 | 命中条目正文合计上限 | 世界书等同关闭 |
| `contextTotal` | 7000 | 世界上下文总上限 | 世界书等同关闭 |
| `currentState` | 2500 | 当前状态视图上限 | **`<current_state>` 仍会注入**，只是被压到约 1 token 并标记 `truncated` |
| `events` | 1000 | 事件注入上限 | 事件不进入状态视图 |
| `memories` | 1200 | 记忆注入上限 | 记忆不进入状态视图 |
| `maxEntries` | 8 | 单轮最多命中的条目**条数** | 所有世界条目都不会激活 |
| `recentMessages` | 6 | 参与检索的最近消息**条数** | **会被夹到 1**，见下 |
| `recursiveDepth` | 1 | 递归激活深度（MVP 未启用） | 暂无实际影响 |

规则与常见错误：

- **键名逐字符匹配，多余的键会被静默忽略。** `contexTotal`、`max_entries` 这类拼写不会报错，对应预算
  继续用默认值。加载器现在会报告未知键并给出拼写建议。
- **值必须是有限数字，不能加引号。** YAML 里的 `"5000"` 是字符串，会被忽略并回退默认值。
- **0 按原样生效**，不会被改回默认值——把 `maxEntries: 0` 静默改成 8 只会制造新的意外，因此它被当作
  「作者有意关闭该功能」处理，加载器只告警并说明具体关掉了什么。唯一的例外是 `recentMessages`。
- **负数不等于 0。** 大多数字段在使用处有 `Math.max(0, …)`，负数被夹住、效果与 0 相同；但 `examples`
  走 `slice(0, n * 4)`，负数表示**从末尾截掉** `|n| * 4` 个字符，示例依然会注入。想关闭示例请写 `0`。
- **`recentMessages` 没有「关闭」语义，写 0 或负数会被夹到 1。** 检索与状态视图用的是
  `messages.slice(-recentMessages)`，而 JavaScript 里 `-0 === 0`，所以 `slice(-0)` 等价于 `slice(0)`
  ——返回**整段历史**；负数则是「丢掉最旧的 `|n|` 条」。两者都会把**更多**消息灌进检索 query，命中更多
  条目、消耗更多 token，与写下这个值的意图完全相反。因此加载器把它夹到 1（只用最后一条消息检索）并
  告警。想减少检索输入请显式写 `1`。
- 单条超出 `worldEntries` 的世界条目**永远进不了上下文**，无论匹配分多高。`/rp validate` 会单独报告
  这种条目，建议拆分条目或调高预算。
- `budgets` 必须是缩进的键值映射；写成标量或列表会导致整块被忽略。

## Model semantic output schema

`roleplay_finalize_turn` 的 arguments 必须是 JSON schema v2。模型不提供自由字符串 `path`，只选择枚举判别 target：

```json
{
  "schemaVersion": 2,
  "events": [],
  "stateChanges": [
    {
      "op": "replace",
      "target": {
        "domain": "appearance",
        "field": "hair.length"
      },
      "value": "耳下短发",
      "durability": "persistent",
      "confidence": 1,
      "evidence": [
        {
          "source": "assistant",
          "quote": "原本齐肩的黑发已经停在耳下"
        }
      ]
    }
  ],
  "memories": [],
  "uncertainties": []
}
```

`target.domain` 为枚举：`appearance | location | inventory | conditions | relationship | knowledge | goals | questFlags`。每个 domain 使用独立字段枚举或受长度约束的实体 ID。插件将 target 编译为内部 canonical path，例如 `/appearance/hair/length`。旧 v1 path 仅用于旧 Session 兼容读取。

`evidence.quote` 必须是 user 或 assistant 最终文本中的连续逐字子串，不得添加引号、修改标点、改写或拼接多个片段。

## World

文件名必须为 `WORLD.md`：

```markdown
---
spec: pi-roleplay/world@1
id: astra
name: 阿斯特拉王国
description: 简短描述
entryRoot: entries
---

# 世界核心

只写每轮都值得携带的少量全局规则。
```

## World entry

`entryRoot` 下任意 `.md` 文件：

```markdown
---
spec: pi-roleplay/world-entry@1
id: astra-capital
name: 王都
keys: [王都, 塞勒恩]
aliases: [首都]
secondaryKeys: [皇宫]
tags: [geography]
priority: 80
constant: false
enabled: true
parents: [astra]
---

# 正文

只有命中时读取。
```

当前检索规则：

1. `constant: true` 始终候选；
2. `keys` / `aliases` 主匹配，`secondaryKeys` 辅助匹配；
3. 按 constant、匹配分和 priority 排序；
4. 受 `maxEntries` 与 `worldEntries` token 近似预算约束；
5. 条目正文不会写入 session。

`parents` 和 `recursiveDepth` 已保留在格式中，MVP 尚未递归激活父条目。

条目的常见失效原因：

- 既没有 `keys` / `aliases` / `secondaryKeys` 也不是 `constant: true` —— 匹配分恒为 0，**永远不会被命中**。
- frontmatter 未闭合 —— 所有键都为空，等同于上一条。
- 与另一条目 id 相同 —— 分数较低的那条被静默去重丢弃。
- 单条估算 token 超过角色的 `budgets.worldEntries` —— 永远放不进上下文。
- `enabled: false` —— 有意关闭，`/rp validate` 会作为「提示」列出。

## 校验

```text
/rp validate            # 检查全部资产
/rp validate alice      # 只检查 alice 及其关联世界
```

输出按 **错误 / 警告 / 提示** 分级，每条都带文件路径、后果和修复动作；没有任何问题时也会给出
「N 个角色、M 个世界、K 个条目，未发现问题」的正面反馈。该命令直接读取磁盘当前内容，不需要先
`/rp reload`，也不会改变当前会话已选择的角色。
