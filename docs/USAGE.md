# 玩法手册

## 心智模型

一个 pi 会话有**两种模式**，随时切换：

- **编码模式**（默认）：正常的 pi，AGENTS.md、skills、read/bash/edit/write 都在。
- **角色扮演模式**：system prompt 整套换成叙事引擎提示词，工具只剩 `rp_state`/`rp_memory`/`rp_dice`，
  世界书与剧情状态按轮注入。

一个会话 = **一个角色 + 一条剧情线**。状态、记忆、场景都记在这个会话的分支里，
所以「继续上次的剧情」= 继续那个会话（`pi -c` / `/rp use` 后会自动恢复）。

## 三条典型动线

**① 开一局**

```
/rp list                  # 看有哪些卡和世界
/rp use linyan            # 入戏：自动放开场白（可关），状态栏出现 🎭 林砚
（直接说话，就是在剧情里说话）
```

**② 中途出戏问规则 / 跳出去干活**

```
(( 你刚才那个线索是几年前的？ ))      # 消息用 (( )) 或 // 开头 = OOC，不推进剧情
/rp ooc 帮我把人物关系列一下            # 等价，且一定触发一轮回复
/rp off                                # 完全退出角色模式，恢复编码工具
（干完活再 /rp use linyan 继续，剧情与状态都在）
```

**③ 用社区卡**

```
把卡文件放进 ~/Roleplay/ 或任意路径
/rp import ~/Downloads/某卡.png        # 支持 PNG 卡 / v1·v2·v3 JSON
/rp validate                           # 一定会跑：这类插件失败是静默的
/rp reload                             # 重新读资产
/rp list && /rp use <新卡 id>
```

## 命令全表

| 命令 | 作用 | 备注 |
|---|---|---|
| `/rp use <id>` | 进入角色模式 | 别名 `/rp on <id>`、`/rp <id>`；已在别的角色里需先 `/rp off` |
| `/rp off` | 退出角色模式 | 还原进入前的工具集；本会话不会被分支记录"装回来" |
| `/rp status` | 当前角色 / 世界 / 场景 / 工具 / 上轮注入量 | 进不来时先看这个 |
| `/rp list` | 列出角色与世界 | 显示 id、名字、绑定世界、条目数 |
| `/rp inspect` | 看细节 | `character`（卡字段）、`system`（**真实生效的 RP 提示词**，落盘到 `dump/`）、`world`（全部条目 + 上轮命中）、`state`（场景/状态项/最近记忆）、`config`（生效配置与来源） |
| `/rp greet [n]` | 重发开场白 | 1 = 首条，2+ = 备选开场白；重开一局时用 |
| `/rp ooc <内容>` | 以出戏身份说一句 | 内部发 `((OOC：…))`，一定会触发起一轮回复 |
| `/rp import <文件>` | 导入角色卡或世界书 | 拷进 `~/.pi/agent/roleplay/`，不覆盖同名文件；名字里带 world/lore/book 的走世界书目录 |
| `/rp init [global\|project]` | 安装示例资产 | `global` → `~/.pi/agent/roleplay/`，`project` → `<cwd>/.pi/roleplay/`；**装完不会自动入戏** |
| `/rp validate [id]` | 校验资产 | 未闭合 frontmatter、无关键词条目、悬空世界绑定、解析失败都会带文件路径 + 修复建议 |
| `/rp reload` | 重新读资产与配置 | 改完卡/世界书/config 后跑 |
| `/rp help` | 命令提示 | |

**启动参数**

| 参数 | 作用 |
|---|---|
| `--role <id>` | 启动即入戏（`pi --role linyan`） |
| `--no-role` | 本次强制不入戏，优先级最高（临时只想写代码时用） |
| Ctrl+Alt+R | 一键切换：不在戏里则用第一个角色入戏，在戏里则退出 |

## 模型实际看到的上下文

**system prompt（唯一一份，约 2.2k 字符）**：RP 总纲（角色/输出规范/工具/世界书/OOC 约定）+
`<character>` 角色卡 + `<world>` 世界描述 + 卡自带 `system_prompt`（+ `extraSystemPrompt` / `SYSTEM.md`）。

**每轮注入到最新 user 消息尾部的块**：

```
<roleplay_context>
  <roleplay_state>     场景 + 状态键值（rp_state 维护）
  <roleplay_memories>  最近 N 条长期记忆（rp_memory 维护）
  <world_entries>      常驻条目 + 关键词命中条目（按 priority 与 token 预算）
</roleplay_context>
<director_notes>       卡的 post_history_instructions（压在最末）
```

## 三个 RP 工具在做什么

模型自己调用，不用你操心；知道它们的存在便于理解它的行为：

| 工具 | 何时被调 | 效果 |
|---|---|---|
| `rp_state` | 剧情真的变了（位置、时间、物品、伤势、关系、情绪） | 更新状态块；无事发生就别调（提示词里明确要求） |
| `rp_memory` | 出现值得长期记住的事（承诺、秘密、关系变化、伏笔） | 记住/召回/删除；每轮自动注入最近若干条 |
| `rp_dice` | 需要随机判定（成败、概率、偶然） | `d100` / `2d6` / `3d8+2`，避免模型自己编随机结果 |

## 配置（`~/.pi/agent/roleplay/config.json`，全部可选）

```json
{
  "scanDepth": 4,           // 世界书扫描最近几条消息
  "scanCharLimit": 6000,    // 扫描文本字符上限
  "worldTokenBudget": 1200, // 每轮世界书注入 token 预算
  "maxWorldEntries": 12,    // 每轮最多注入条目数
  "memoryLimit": 12,        // 每轮自动注入记忆条数
  "memoryCap": 200,         // 记忆总量上限（超出按重要度裁）
  "autoGreet": true,        // 入戏时自动放开场白
  "wholeWordDefault": false,
  "extraSystemPrompt": "",  // 追加到总纲之后，例如「用简体中文，每段不超过 3 句」
  "systemPromptFile": ""    // 用文件整体替换总纲
}
```

- 想全局微调文风 → `extraSystemPrompt`；
- 想彻底换掉我写的那套总纲 → 放一个 `~/.pi/agent/roleplay/SYSTEM.md`（项目级 `<cwd>/.pi/roleplay/SYSTEM.md` 优先）；
- 长会话吃 token → 降 `worldTokenBudget` / `memoryLimit` / `maxWorldEntries`。

## 资产布局

```
~/.pi/agent/roleplay/            # 全局（手机 tile 用的是这个）
├── config.json
├── SYSTEM.md                    # 可选：替换 RP 总纲
├── characters/<id>/card.json | card.png | CHARACTER.md
├── worlds/<id>/WORLD.md + entries/*.md | *.json
└── dump/                        # /rp inspect system 的落盘输出
<cwd>/.pi/roleplay/              # 项目级，覆盖全局同名 id
```

格式细节见 [FORMAT.md](FORMAT.md)；SillyTavern 字段映射与不支持项见 [ST-COMPAT.md](ST-COMPAT.md)。

## 玩法技巧

- **导戏**：不要写"我希望林砚怀疑我"，直接演——"我把箱子推开"，让他自己反应。要暗示，用剧情内的动作/台词。
- **让它记得牢**：重要承诺说完加一句"（记一下：他把钥匙交给了我）"，模型多半会调 `rp_memory`；忘了也可以直接说"用 rp_memory 记住这条"。
- **别让它替你决定**：总纲里已写"不替你决定台词与动作"。若越界，`(( 别替我说话 ))` 纠正一句即可。
- **改设定**：说"（设定：东码头已经封锁）"这种 OOC 补充，或直接改世界书条目再 `/rp reload`（改文件才是持久的）。
- **换角色**：先 `/rp off` 再 `/rp use <另一个>`，或直接 `/new` 开新会话（状态绑角色，不共享）。
- **重开**：`/rp off` → `/rp use <id>` 会用同一会话恢复状态；想彻底重来就 `/new` 后 `/rp use`，或 `/rp greet 2` 换个开场白。
- **备份剧情**：`/export` 导出会话（HTML/JSONL）；状态都在会话里，所以导出=完整备份。
- **看它到底在想什么规则**：`/rp inspect system` 把真实生效的提示词落盘，直接读文件。

## 手机端（Roleplay tile）

- 在 App 的 Roleplay tile 里，命令和桌面完全一样，直接发 `/rp list` 就能用。
- 桌面想驱动它：`node ~/.pi/agent/npm/node_modules/remote-pi/dist/index.js daemon send 575a466f "/rp inspect state"`。
- 改了扩展代码：`… daemon restart 575a466f` 才生效（不要在 Jarvis 会话里重启 Jarvis）。
- mesh 的 agent-to-agent 消息**不能**用来测 slash 命令（会被包一层 envelope，`/rp …` 变成普通发言）。

## 已知边界

- 单角色身份：同一会话不支持热切换角色；没有群聊/多角色同场。
- 世界书只按关键词 + 预算选条，不支持 ST 的 `position`/`depth`/`sticky`/递归扫描。
- 记忆召回是朴素词元打分，不是向量检索。
- 每轮注入块对"用户原话"是可见的附加文本（这是为保住 prompt cache 的取舍）。
