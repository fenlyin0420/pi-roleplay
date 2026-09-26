# @xicode/pi-roleplay

面向 [pi](https://pi.dev) 的 Markdown-first 角色扮演扩展。MVP 专注短会话效果：固定角色人格、惰性世界书检索、分支可恢复的角色选择，以及 DeepSeek V4 首条 user 消息适配。

## 安装

从 npm 安装：

```bash
pi install npm:@xicode/pi-roleplay
```

在 monorepo 中开发和临时运行：

```bash
pnpm --filter @xicode/pi-roleplay build
pi -e ./packages/pi-roleplay/dist/extension.js
```

资产目录：

```text
全局：~/.pi/agent/roleplay/
项目：<cwd>/.pi/roleplay/   # 需要信任项目
```

复制示例资产，或在 Pi 内运行 `/rp init global`：

```text
examples/roleplay/characters/alice → ~/.pi/agent/roleplay/characters/alice
examples/roleplay/worlds/astra     → ~/.pi/agent/roleplay/worlds/astra
```

**安装示例资产不会自动开启角色模式。** `/rp init global` 只把文件放到资产目录；角色卡装在那里
不代表你希望每个 Pi 会话都进入角色。装完之后用 `/rp use <id>` 显式开启。

启动后：

```text
/rp status
/rp list
/rp init global       # 将包内示例安装到 ~/.pi/agent/roleplay（不会自动开启角色）
/rp init project      # 将包内示例安装到 <cwd>/.pi/roleplay
/rp use alice         # 为当前 Session 开启角色
/rp off               # 停用当前 Session 的角色，回到纯编码模式
/rp reload
/rp validate          # 校验全部资产：未闭合 frontmatter、id 冲突、worlds 拼错、budgets 非法值
/rp validate alice    # 只校验一张卡及其关联世界
/rp inspect           # 查看角色卡、当前世界上下文和有效 system prompt
/rp inspect character
/rp inspect world
/rp inspect system
/rp path
```

资产写错时几乎所有失败都是静默的（世界书不生效、卡片不出现在列表里、budgets 回到默认值），
因此改完 Markdown 后建议先跑一次 `/rp validate`。输出按错误 / 警告 / 提示分级，每条都带文件路径、
后果和修复动作；详见 [`docs/FORMAT.md`](docs/FORMAT.md)。

## 角色何时被启用

角色是显式 opt-in。只有下列任一条件成立时才会注入角色卡、激活 `roleplay_finalize_turn`
及其 promptGuidelines，并逐轮注入世界书与当前状态：

- 启动时带了 `--role <id>`；
- 当前 branch 已有记录了 `characterId` 的 `pi-roleplay-state` entry（旧会话恢复）；
- 当前 branch 已被 Commit、Checkpoint 等结构化状态记录锁定身份（旧剧情恢复）；
- 本次会话跑过 `/rp use <id>`。

资产目录里有角色卡但你从没表达过意图时，插件保持关闭，纯编码会话不会带上任何角色扮演内容。
进行中的旧剧情不受影响：只要分支上有选择记录或结构化状态记录，恢复后仍然是原来的角色。

用 `/tree` 导航时，如果目标节点早于第一条角色记录（那条路径上确实没有任何角色记录），但当前会话
已经处于角色模式，角色会保持激活而不是凭空消失——你显然还在剧情里。反之，从没进入过角色模式的
纯编码会话不会因为切换分支被激活。`/rp off` 与 `--no-role` 的关闭意图始终优先于这条保持规则。

```bash
pi --role alice     # 本次启动直接进入角色
pi --no-role        # 本次启动强制不激活，优先级高于分支上恢复的选择
```

`--no-role` 是布尔 flag，Pi 的参数解析会把紧跟其后的非 flag 参数当成它的值吃掉。要同时带首条
消息时写成 `pi "帮我改这个函数" --no-role` 或 `pi --no-role=1 "帮我改这个函数"`。注意宿主对布尔
flag 一律归一为「已设置」，所以 `--no-role=0` 同样是关闭，没有传个假值让它不生效的写法。

`/rp off` 停用当前 Session 的角色，并把这个决定同时记在两个地方：一条写进当前 branch 的
`pi-roleplay-state` entry（跟着分支路径走，跨重启存活），以及本次会话的进程内意图（跟着会话走，
跨分支存活）。两者都必要——只靠分支记录的话，一次 `/tree` 导航、或编辑重试一条更早的 user 消息，
都会让新路径不含那条停用记录，角色就被原样装回来了。所以 `/rp off` 之后无论怎么切分支都不会自动
恢复角色，直到你显式 `/rp use <id>`。

剧情记录不会丢失：已锁定的 Session 执行 `/rp off` 后仍然绑定原角色，随时 `/rp use <同一角色>`
即可续上。`--no-role` 与 `/rp off` 都不删除任何 entry。

实际 DeepSeek E2E：

```bash
# 默认使用模型模式 deepseek-v4-flash，由 Pi 从当前内置/配置模型目录解析
pnpm test:e2e:deepseek

# 也可指定其他 Pi 模型模式，不在脚本中硬编码 provider 或日期版本
pnpm test:e2e:deepseek -- --model deepseek-v4-pro
pnpm test:e2e:deepseek -- --model tokenhub/deepseek-v4-flash-202605

# 只验证请求到达 Provider 前的完整注入链；Provider 套餐拒绝也不算失败
pnpm test:e2e:deepseek -- --smoke-only --keep
```

E2E 使用临时 `PI_CODING_AGENT_DIR`，复制现有认证和示例资产，并通过 probe extension 验证：角色 system prompt、Pi runtime 保留、世界条目命中、DeepSeek 第一条 user 注入及真实模型回复。默认严格模式要求 Provider 成功返回文本。

实际状态恢复 E2E（剪发 → 关闭并恢复 Session → 识别当前短发）：

```bash
pnpm test:e2e:state
```

真实 Pi Session Tree 生命周期 E2E：

```bash
pnpm test:e2e:session-tree
```

该脚本不直接编辑 JSONL，而是通过扩展命令调用 Pi 的 `navigateTree`、`fork(position=before|at)` 和 `compact`。它断言 tree hooks、fork 新实例、`parentSession`、分支状态继承以及 compaction 后自动 Checkpoint。

当前版本采用 inline-tool + sidecar-on-missing + session persistence + risk-based review。主模型正常调用
`roleplay_finalize_turn` 时直接提交；若主模型漏调，插件会在回复结束后用同一模型和认证做一次隔离的
结构化提取。两条路径都经过相同的证据、路径、置信度、revision 和 hash 校验；角色初始定义及世界
canon 不允许通过状态工具修改。

角色模式的最终 system prompt 末尾带有强制回合完成协议：主模型必须先输出自然语言角色回复，再调用
`roleplay_finalize_turn` 恰好一次；没有语义变化也必须提交四个空数组。sidecar 只用于不遵守该协议
或 Provider 未返回工具调用时的兼容性兜底，不是默认的剧情理解路径。

每次 inline finalize、主模型漏调和 sidecar 尝试都会追加 branch-local
`pi-roleplay-audit`。`/rp status` 优先显示本轮主模型调用次数、是否漏调、sidecar 路径和结果，
并附当前 branch 的调用覆盖率等累计指标；`/rp inspect audit` 展示聚合指标和最近 30 条明细。审计只保存来源、结果、
模型标识、耗时和数量，不保存提示词、认证、原文或完整工具参数；错误文本会脱敏并截断。

审批命令：

```text
/rp review                                  列出全部待审项
/rp review accept <序号|短别名|review-id>    接受单条
/rp review reject <序号|短别名|review-id>    拒绝单条
/rp review accept all                       批量接受全部
/rp review reject all                       批量拒绝全部
/rp review accept all --risk=medium         只批量处理指定风险等级（medium|high）
/rp review accept all --yes                 明确放弃预览，直接执行
/rp review amend <序号|短别名|review-id> <json>
```

待审项可以用三种方式引用：列表里的序号、reviewId 前 8 位的短别名（形如 `#4f3a1c2d`，可省略 `#`），或完整 `review-…` id。短别名前缀匹配到多条时命令会报错并列出候选，不会替你猜；万一某个短别名恰好是纯数字并落在序号范围内，用 `#` 前缀或完整 id 可以强制按别名解析。`all` 也可以写作 `--all`；单独给出 `medium` 或 `high` 等价于 `all --risk=<等级>`。

待审项和批量参数不能混用：`/rp review accept 3 --risk=high` 会报错，而不是悄悄改成按 `--risk=high` 批量执行。多余的位置参数（如 `/rp review accept 1 2`）同样报错，不会静默只处理第一个。

待审队列是常驻可见的，不需要主动去查：

- 一轮对话产生待审项时会立即弹出一条 warning 通知，列出每条变化和处理命令。
- 状态栏常驻 `rp:review N`。队列清空、或用 `/tree` 切到没有待审项的分支后，该状态项会消失。
- `/rp status` 含一行「待确认状态变化：N」。

列表、选择器和确认框共用同一套可读描述，形如 `[high] 信任 bob: 0.7 → 0.3 · "你根本不该来"`：风险等级、可读字段名、原值→新值（提案没声明原值时回落到 Current State 上的真实值）、以及 evidence 引文节选。这些文本全部由模型产生，因此渲染前会把控制字符和 ANSI 转义折叠成空格——否则一条待审项就能在确认框里伪造出额外的变更行。

有交互 UI 时，accept 与 reject 都会先弹确认框（`--yes` 可跳过）：单条确认展示 reason、路径、置信度、来源回合和逐字 evidence，批量确认一次性列出全部变更行。批量操作另有两道闸门：

- 没有交互 UI（RPC / print 模式）时，多于一条的批量操作会中止并列出将要处理的全部条目，要求你确认后重新运行并加 `--yes`。单条不受影响。
- 一次超过 20 条时同样中止。队列是跨回合累加的（20 只是每轮提案的上限），长剧情攒到上百条很正常，而上百行的确认框没人会读完。这里宁可拒绝也不截断列表——截断意味着你批准的正是自己没看到的部分。请先用 `--risk` 收窄或分批处理，确实要一次做完再加 `--yes`。

接受操作会追加 `pi-roleplay-review-decision` custom entry，并生成来源为 `review-accept` 的新 Commit；拒绝操作只追加决定，不修改 Current State。批量操作逐条走同一条路径，因此每条接受都落在自己的 revision 上。两者都跟随当前 Session branch，且不会编辑旧 JSONL。

## 手动写入、纠错与修复

所有命令都向当前 Pi branch 追加结构化 custom entry，不直接编辑 JSONL：

```text
/rp state set {"op":"replace","path":"/location","value":"王都","reason":"用户显式补录"}
/rp state correct {"op":"replace","path":"/location","from":"王都南门","value":"旧城区旅店","reason":"地点记录错误","correctsCommitId":"commit-..."}
/rp event add {"kind":"arrival","summary":"爱丽丝抵达旧城区旅店。","reason":"用户显式补录"}
/rp memory add {"summary":"我记得抵达旅店的夜晚。","eventId":"evt-...","retrievalKeys":["旅店"],"reason":"用户显式补录"}
/rp review amend <review-id> {"value":0.4,"durability":"temporary"}
/rp turn repair
/rp archive
```

命令参数中 JSON 之后的部分按**原始字节**交给解析器：value、summary 和 evidence.quote 里的连续空格、缩进与转义都会逐字保留。相应地，JSON 字符串里不能出现字面换行——直接粘贴多段原文会带上真实换行，必须写成 `\n`；命令会指出出错的行列并说明怎么改。JSON 文档外侧的空白会被裁掉，所以用中文输入法打出的全角空格（U+3000）作分隔符不影响使用；若它出现在 JSON 内部，错误信息会点名指出。

### `/rp turn repair`

不带参数执行会展示待修复回合：目标 entry、该回合 user 与 assistant 的**完整原文**、一条可直接复制的引文候选，以及一条 proposal 骨架。有 TUI 时用编辑器展示，否则退化为通知。

骨架里的 `kind`、`summary` 和 `evidence.quote` 都是占位符。占位引文不可能是任何原文的子串，因此**原样提交必然被证据校验拒绝**：不写入任何内容，也不消耗修复机会。请把三处都换成真实内容——引文用上面给出的候选，或自己从原文里摘一段。

```text
/rp turn repair
/rp turn repair {"schemaVersion":2,"events":[{"ref":"event-0","kind":"appearance-change","summary":"爱丽丝把齐肩黑发剪到耳下。","participants":["alice"],"observedBy":["alice"],"importance":0.6,"confidence":0.95,"evidence":[{"source":"assistant","quote":"原本齐肩的黑发已经停在耳下"}]}],"stateChanges":[],"memories":[],"uncertainties":[]}
```

**不要提交空 proposal。** `events`、`stateChanges`、`memories` 全空等于放弃该轮：它不写入任何内容，也修不了这一轮，只是白跑一次。此前照抄空示例还会把该回合永久标记为已修复；现在失败的尝试只留审计记录，不再消耗修复机会。

可修复的回合有两类：主模型漏调 finalize 且自动 sidecar 也失败的 `incomplete`，以及 inline/sidecar
提交后所有实质变化都没通过校验的 `finalized-rejected`（只剩 `uncertainties` 的空 commit 同样算
这一类）。后者会在发生时以 warning 通知并在状态栏标出，不再静默丢弃整轮状态变化。

修复结果如实报告：

- 全部写入 → info，说明写了几条事件 / 状态变化 / 记忆；
- 部分写入 → warning，列出被拒条目；该回合机会已用掉，剩余内容用 `/rp event add` 等补录；
- 只产生待审项 → info，明说「尚未写入任何内容」；待审期间占用修复机会，若这些待审项被 `/rp review reject` 全部拒绝，则一个字都没落盘，该回合**重新变为可修复**；
- 一条都没写入 → warning，逐条列出被拒理由；**不消耗机会**，改好后可以重试。

判据始终是「实际落盘了什么」，而不是「有没有留下 repair 记录」。

evidence.quote 必须是该回合 user 或 assistant 原文的逐字连续子串。这条规则不为修复放宽，但引文不匹配时会明确说明「必须逐字一致」并回显实际收到的 quote。

Correction Commit 不移动 Session Tree，也不删除旧 Commit；Review Amendment 只能修改 `value`、`from` 和 `durability`，原提案继续保留；Repair 重新执行同一 evidence validator，每个回合最多接受一次真正落盘的修复。

自动 sidecar-on-missing 默认开启。它只在主模型漏调 finalize 时运行，输入被限制为本轮最终 user /
assistant 原文与 Current State，强制只返回工具参数，并继续走同一个 evidence validator；不会调用
`sendUserMessage()`，也不会向剧情 Session 注入伪造消息。结果以 branch-local
`pi-roleplay-sidecar` 原子 entry 保存并复用灰色回合摘要。若模型、认证或提取结果不可用，才回退为
`incomplete`，状态栏显示「剧情未同步」，仍可用 `/rp turn repair` 显式补交。

可手动创建恢复基点：

```text
/rp checkpoint
```

Checkpoint 保存 revision、state、state hash、完整 events/memories、pending reviews 与 turn status。Reducer 只从 `ctx.sessionManager.getBranch()` 提供的当前路径中选择最新有效 checkpoint，再重放其后的 Commit；不会扫描其他 tree branch。Compaction 前后会校验 character、revision 和 state hash，一致时自动在 compaction entry 后追加 branch-local checkpoint。

剧情历史撤销与分叉服从 Pi 原生机制：

```text
/tree   回到旧节点并在同一 Session 中创建 branch
/fork   从旧节点创建独立 Session
/clone  复制活动路径到指定 entry
```

插件不会另建历史栈，也不会用 inverse Commit 冒充 `/tree`。未来的 Correction Commit 只用于“当前时间线记录有误”，不是历史导航。完整语义见 [`docs/SESSION-TREE-INTEGRATION.md`](docs/SESSION-TREE-INTEGRATION.md)。

模型遗漏 finalize 时，插件在 `agent_settled` 后先运行隔离 sidecar：成功则追加
`pi-roleplay-sidecar` 并显示与 inline tool 相同的灰色摘要；失败才追加 `pi-roleplay-turn-status`
并标记为 `incomplete`。inline 或 sidecar 的变化全部被证据校验拒绝时，该回合记为
`finalized-rejected` 并当场通知用户。两类失败回合都可以用 `/rp turn repair` 补交。

实际功能命令与长期 Session E2E：

```bash
pnpm test:e2e:features
pnpm test:e2e:long-session
```

`test:e2e:features` 验证 Correction、手动 Event/State/Memory、Review Amendment、Repair、Archive、Checkpoint 与资产 hash。`test:e2e:long-session` 验证 1200 Commit、多个 Checkpoint、v1→v2 内存迁移、Archive 和有/无 Checkpoint 的 reducer 性能门。

## 资产约定

```text
roleplay/
├── characters/
│   └── alice/
│       ├── CHARACTER.md
│       └── examples.md
└── worlds/
    └── astra/
        ├── WORLD.md
        └── entries/**/*.md
```

- `CHARACTER.md`：完整装入 system prompt，默认不可变。
- `WORLD.md`：小型世界核心，随角色关联世界装入动态上下文。
- `entries/**/*.md`：启动时只读取 frontmatter；正文命中关键词后才读取。
- JSON/PNG 酒馆卡未来通过 importer 转换为上述 Markdown，不作为原生运行格式。

详细规范见 [`docs/FORMAT.md`](docs/FORMAT.md)，架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

若要直观看懂资产、Pi session、运行时 hooks、最终 Provider payload 与 Telemetry 的关系，请阅读：

- [`docs/RUNTIME-AND-SESSION.md`](docs/RUNTIME-AND-SESSION.md) — 含真实 DeepSeek 调用、真实 JSONL session、最终 payload 和 Mermaid 流程图；
- [`docs/SESSION-ROADMAP.md`](docs/SESSION-ROADMAP.md) — 后续 Session-first 长会话研究与实现基线；
- `docs/evidence/deepseek-v4-flash-202605/` — 本次演示的脱敏原始证据；只存在于源码仓库，不随 npm 包发布，关键片段已内联在 `RUNTIME-AND-SESSION.md` 中。

- `/rp inspect` 使用编辑器预览实际运行时注入内容；这些内容默认不会作为聊天消息显示。
- DeepSeek Provider payload 属于最底层请求内容，只在 E2E probe 日志中显示，避免泄露隐藏提示词。

## 当前能力

- Markdown + YAML frontmatter 角色卡与世界书
- 全局和项目资产合并（项目同 ID 覆盖全局）
- 角色显式 opt-in：只有 `--role <id>`、`/rp use <id>` 或分支上已有的选择/结构化状态记录才会启用角色；catalog 非空不再等于开启角色模式
- `/rp off` 停用当前 Session 的角色并把决定持久化到当前 branch；`--no-role` 在本次启动强制不激活，优先级高于恢复的选择
- `/rp validate [<id>]` 显式校验资产：未闭合 frontmatter、缺失 `CHARACTER.md`、id 冲突、`worlds` 引用不存在的世界、`budgets` 未知键与非法值，均给出文件路径、后果和修复动作；加载期同样会主动报告，不再静默
- `/rp use <id>` 只用于剧情开始前选择当前 Session 的角色；首次角色回复或产生结构化状态后角色身份锁定，不支持同一 Session 内热切换
- `before_agent_start` 前置人格，同时保留 Pi 工具与项目提示词
- `context` 对最新 user 消息非持久化注入世界核心及命中条目
- DeepSeek V4 `before_provider_request` 第一条 user 末尾沉浸指令
- `roleplay_finalize_turn`：由 LLM 在最终回复中提交 evidence-backed Event、State Change、Memory 与 Uncertainty
- Inline Turn Commit 以 Pi `toolResult.details` 持久化；漏调补提取以
  `pi-roleplay-sidecar` 原子持久化，两者都沿当前 session branch 确定性恢复
- 角色回合在 transcript 中只留一行安静的灰色摘要文本（见下方「回合摘要显示」），不再打印机器协议
- 低风险状态自动接受；relationship、knowledge、goals、questFlags 进入待审队列，可用 `/rp review` 接受或拒绝
- `agent_settled` 检测启用状态工具却未 finalize 的回合，先运行隔离 sidecar；只有 sidecar 失败才以
  `pi-roleplay-turn-status` 标记为 incomplete，footer 显示「剧情未同步」
- `/rp checkpoint` 追加带 state hash 的 `pi-roleplay-checkpoint`；reducer 从最新有效 checkpoint 重放后续 Commit，compaction 后自动生成经三重校验的 branch-local checkpoint
- 角色模式下从瞬时 LLM context 移除 Pi `branchSummary`，保留原 Session entry 但避免替代时间线污染 canon
- 结构化 validation issue 区分 schema、evidence、permission、conflict 与 review
- Current State、相关事件和相关记忆各有可配置子预算；Lazy World Context 取 `budgets.contextTotal` 减去 Current View 实际用量后的余额（注意 Current View 本身受三个子预算之和约束，不受 `contextTotal` 约束，详见 [`docs/SESSION-ROADMAP.md`](docs/SESSION-ROADMAP.md)）
- 内部持久化 schema v2；Reducer 在内存中兼容迁移 v1 Commit/Review/Turn/Checkpoint，不修改旧 entry
- `/rp state correct` 追加带 `correctsCommitId` 与 reason 的 Correction Commit
- `/rp event add`、`/rp state set`、`/rp memory add` 支持无 LLM 的显式写入
- `/rp review amend` 保留原提案并限制可编辑字段；`/rp turn repair` 修复 incomplete 与 finalized-rejected 回合，失败的尝试不消耗修复机会
- 命令参数中的 JSON 保留原始字节，不再折叠空白；解析失败时给出行列与修改建议
- 每 50 个 Commit 自动创建无损 branch-local Checkpoint；Checkpoint 保存资产 hash
- `/rp archive` 创建完整去重 Event/Memory 归档，原 Commit 不删除
- `/rp status` 概览当前 revision 及事件、状态变化、记忆、存疑数量；`/rp inspect state`
  展开事件、状态变化、记忆、存疑的逐条内容、来源 revision、evidence 与当前 State，并解释
  `rev` 是每个成功剧情 Commit 加一的分支状态版本号，不是事件数量
- `/rp inspect` 报告面板默认从文档顶部打开；面板仍可编辑，但当前不会保存编辑结果
- Pi Session Tree 集成边界：[`docs/SESSION-TREE-INTEGRATION.md`](docs/SESSION-TREE-INTEGRATION.md)

## 回合摘要显示

`roleplay_finalize_turn` 每轮都会调用一次，但它提交的内容是**给模型看的**机器协议
（带 commit id 与 JSON Pointer 的 XML）。这层内容不再直接显示给玩家：工具注册了自己的
渲染器，transcript 里只留一行安静的灰色摘要文本。

（Pi 的工具外壳会在有内容的工具行前固定插入一个空行，所以有变化的回合在屏幕上实际占
两行：一个空行加一行摘要。这是宿主的排版行为，不是本扩展可以控制的。）

- **有实质变化**：一行紧凑摘要，只显示数量与修订号，不含任何 id 或路径。

  ```text
  爱丽丝 · 2 事件 · 1 状态变化 · rev 47
  ```

- **本轮无变化**：整行隐藏。角色扮演里绝大多数回合都不改变状态，这类回合在 transcript
  中不再留下任何痕迹。

- **有待审变化**：黄色告警，并直接给出该敲的命令。高风险的 relationship、knowledge、
  goals、questFlags 变化不会自动生效，不处理就会一直挂在队列里。

  ```text
  ⚠ 1 项状态变化待确认（/rp review）
  ```

- **有被拒变化**：红色提示，指向查看原因的命令。

  ```text
  ✗ 1 项变化被拒（/rp inspect state 查看原因）
  ```

- **工具执行失败**：红色显示失败原因，且**永不隐藏**。覆盖没有启用角色、模型写坏参数、
  按 `ESC` 打断等情况。

  ```text
  ✗ 当前没有启用角色
  ```

按 `ctrl+o` 展开当前回合，可以看到完整明细——事件的 kind 与 summary、状态变化的
`path → value`、记忆、存疑项，以及每条待审变化的风险等级与理由：

```text
爱丽丝 · 2 事件 · 1 状态变化 · rev 47
  事件 location-entered 爱丽丝走进了图书馆
  事件 item-acquired 拿到了封蜡信件
  状态 replace /appearance/hair/length → shoulder
```

摘要只影响显示。写入会话的 Commit 内容、模型看到的工具结果都没有变化。`/rp status` 会显示
剧情账本计数和 `rev` 含义，`/rp inspect state` 是查看事件、状态变化、记忆、存疑及当前状态的
权威入口。若 Session 已生成 Checkpoint，事件和记忆仍保留累计内容；早期状态变化和存疑的逐条
历史不在 Checkpoint 中，检查视图会明确标注只展示 Checkpoint 后的可见 Commit 明细。

## 非目标（当前单角色架构）

当前不支持同一 Session 内热切换角色、群聊或多 Agent。Initial Definition 仍不可变；低风险的 appearance、location、inventory、conditions 只能通过 evidence-backed `roleplay_finalize_turn` 更新 Current State，高风险关系与知识变化必须审批。插件不会从普通自然语言或隐藏 thinking 中静默改写状态，也不会回写源角色卡。后续工作见 [`docs/SESSION-ROADMAP.md`](docs/SESSION-ROADMAP.md)：

```text
Initial Definition + Current State + Event Log + Memories + Lazy World Context
```

状态只来自显式结构化工具、审批或手动命令。尚未完成的项目统一记录在
[`docs/SESSION-ROADMAP.md`](docs/SESSION-ROADMAP.md)，本文不再另列一份。

## 安全边界

角色卡和世界书是提示词资产，可能包含恶意指令。只安装可信资产。项目级 `.pi/roleplay` 会随受信任项目启用。
