# pi-roleplay

给 [pi](https://pi.dev) 加一个**角色扮演模式**：进入后 pi 不再是编码 agent，而是叙事引擎与角色演员。

与把角色卡"叠"在编码提示词上的做法不同，本扩展通过 `forceSystemPrompt` **整套替换** system prompt：
编码 agent 的 AGENTS.md、skills、工具说明在这一模式下**完全不进上下文**，工具集也换成 RP 专用的三个。

## 安装

```bash
# 1) 注册扩展（全局，对所有 pi 进程生效；未进入角色模式时完全惰性）
#    在 ~/.pi/agent/settings.json 里加：
{
  "extensions": ["/home/fenlyin/Documents/GitHub/pi-roleplay/src/index.ts"]
}

# 2) 装示例资产（可选，装完不会自动进入角色模式）
pi -p "/rp init global"

# 3) 直接开戏
pi --role linyan
```

## 命令

| 命令 | 作用 |
|---|---|
| `/rp use <id>` | 进入角色模式（同一会话不热切换角色；`/rp on` 等价） |
| `/rp off` | 退出，恢复编码模式与进入前的工具集 |
| `/rp status` | 当前角色 / 场景 / 工具 / 上轮注入量 |
| `/rp list` | 列出角色与世界 |
| `/rp inspect [character\|system\|world\|state\|config]` | `system` 会把**真实生效的 RP prompt** 落盘 |
| `/rp greet [n]` | 重发第 n 条开场白（1 = 首条，2+ = 备选开场白） |
| `/rp ooc <内容>` | 以出戏身份说一句（不推进剧情） |
| `/rp import <文件>` | 导入 ST 角色卡（json/png）或世界书 json |
| `/rp init [global\|project]` | 安装示例资产 |
| `/rp validate [id]` | 校验资产；这类插件的失败几乎都是静默的，改完资产先跑这个 |
| `/rp reload` | 重新读取资产与配置 |

启动参数：`--role <id>`（启动即入戏）、`--no-role`（本次强制不入戏，优先级最高）。
快捷键：`Ctrl+Alt+R` 切换。

## 资产

```
~/.pi/agent/roleplay/          # 全局
<cwd>/.pi/roleplay/            # 项目级（覆盖全局同名 id）
├── config.json                # 可选：预算与行为配置
├── SYSTEM.md                  # 可选：整体替换内置 RP 总纲
├── characters/<id>/card.json | card.png | CHARACTER.md
└── worlds/<id>/WORLD.md | WORLD.json + entries/*.md | *.json
```

支持 SillyTavern 资产：v1/v2/v3 角色卡 JSON、含 `chara`/`ccv3` 文本块的 PNG 卡、World Info 世界书 JSON
（含 `character_book` 内嵌书）。字段映射与不支持项见 [docs/ST-COMPAT.md](docs/ST-COMPAT.md)，
玩法与命令详解见 [docs/USAGE.md](docs/USAGE.md)；格式细节见 [docs/FORMAT.md](docs/FORMAT.md)。

## 配置（`config.json`，全部可选）

```json
{
  "scanDepth": 4,          // 世界书扫描最近多少条消息
  "scanCharLimit": 6000,   // 扫描文本字符上限
  "worldTokenBudget": 1200,// 每轮世界书注入 token 预算
  "maxWorldEntries": 12,   // 每轮最多注入条目数
  "memoryLimit": 12,       // 每轮自动注入最近多少条记忆
  "memoryCap": 200,        // 记忆总量上限（超出按重要度裁剪）
  "autoGreet": true,       // 入戏时自动放出开场白
  "wholeWordDefault": false,
  "extraSystemPrompt": "", // 追加到 RP 总纲之后
  "systemPromptFile": ""   // 用文件整体替换 RP 总纲
}
```

## RP 工具（角色模式下唯一可用的三个）

- `rp_state` —— 场景与可变状态（位置/时间/物品/伤势/关系/情绪），只记已发生的事实；
- `rp_memory` —— 长期记忆：记住 / 召回 / 删除，每轮自动注入最近若干条；
- `rp_dice` —— 随机判定（`d100`、`2d6`、`3d8+2`），避免模型自己编随机结果。

编码工具（`read`/`bash`/`edit`/`write`）在角色模式下**不可用**，即使被其它扩展或技能装回来，
`tool_call` 兜底也会拦截。

## 已验证行为

在隔离 agent 目录下用 `before_provider_request` 探针验证（方法见 [docs/DESIGN.md](docs/DESIGN.md)）：

| 场景 | 结果 |
|---|---|
| `--role linyan` | system prompt 仅 2221 字符的 RP 提示词；无编码提示、无 `<skills>`、无 `<docs>`；工具 = 3 个 RP 工具 |
| 关键词世界书 | 常驻条目恒定注入 + 命中条目（`验尸` → 验尸规程）按 priority 注入，预算内截断 |
| `rp_state` 调用 | 状态写入 session entry；下一轮注入块立即反映（场景/位置/物证/情绪） |
| 会话恢复 `pi -c` | 从 branch 记录恢复角色、状态、记忆，无需任何 flag |
| `--no-role` / 未入戏 | 编码 prompt 与 4 个编码工具原样保留，RP 工具被摘掉 |
| `/tree` 分叉 | 模式跟随目标分支的记录 |

## 已知取舍

- 世界书/状态注入走**最新 user 消息尾部**的 `<roleplay_context>`，不是 system 消息（forced prompt 会折叠
  中途 system 消息，见 DESIGN）。因此这些内容对"用户原话"是可见的附加块，模型按约定区分。
- 开场白以带标记的 custom message 呈现（`（已发生的开场，非用户发言）`），不是 assistant 角色消息：
  零额外调用，且不会让模型误认为用户说了角色台词。
- 键控压缩是"剧情摘要"口径（保留人物、承诺、伏笔、当前局面），压缩由主模型完成，不额外切模型。
- 同一会话不支持热切换角色（换角色请先 `/rp off` 或开新会话）：状态、记忆与剧情是绑定角色的。

## 开发

```bash
npm install          # typescript + @types/node（仅类型检查用）
npx tsc --noEmit     # 类型检查
node --test tests/*.test.ts   # 28 个纯逻辑单测
```

`node_modules/@earendil-works/*` 与 `typebox` 是指向全局 pi 安装的软链，只为本地类型解析；
扩展运行时由 pi 自己解析这些模块。
