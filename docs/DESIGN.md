# 设计说明

## 目标

让 pi 有一个真正的"角色扮演模式"：整套 system prompt、世界书上下文、工具集都换掉，
而编码模式完全不受影响（默认仍是纯编码 agent，装扩展即惰性）。

## 与"叠加式"方案的区别

实测 `@xicode/pi-roleplay` v0.5.0（见 [EVAL-pi-roleplay.md](EVAL-pi-roleplay.md)）的做法是
`角色卡 + 原 Pi system prompt`，结果 system prompt 的 83% 仍是"expert coding assistant / 编码技能清单 /
Pi 文档索引"，并且 `read/bash/edit/write` 一直暴露。本扩展选择相反的方向：

| 维度 | 叠加式 | pi-roleplay |
|---|---|---|
| system prompt | 角色卡前缀 + 编码 prompt | `forceSystemPrompt` 整套替换 |
| skills / AGENTS.md | 照旧注入 | 不进上下文（forced prompt 无 sections） |
| 工具 | 只增不减 | `setActiveTools` 换成 3 个 RP 工具 + `tool_call` 兜底 |
| 世界书 | 注入 user 消息 | 同样注入 user 消息（此处一致，理由见下） |
| 每轮成本 | 附带一个 7.8KB 的强制工具 schema + 可能一次 sidecar 调用 | 只多一段按预算裁剪的注入块 |

## 关键设计决策

### 1. 为什么用 `forceSystemPrompt`

`before_agent_start` 里既可返回 `systemPrompt`，也可设置 `systemPromptOptions.forceSystemPrompt`。
源码里 `buildSystemPromptState()` 的行为是：

```js
if (input.forceSystemPrompt !== undefined) return { content: input.forceSystemPrompt };  // 无 sections
return { content: "", sections: buildSystemPromptSections(input) };
```

即 forced prompt 是一条**不透明**的 prompt，不再拼接 sections —— 而 `contextFiles`（AGENTS.md）、
`skills`、`docs`、`cwd` 全都是 sections，于是自动被排除。这正是"整套替换"的原语。

代码里两条路径都写了（就地设置 `forceSystemPrompt` + 返回 `systemPrompt`），因为两个方向的文档描述
都指向"整套替换"，不同 pi 版本可能走不同分支；两者文本相同，重复无害。

**验收方式**：不要在 `context_with_system` 里看 prompt —— Pi 会在该阶段"恢复"自己的结构化 prompt，
`ctx.getSystemPrompt()` 也不反映最终投影。唯一可信的是 `before_provider_request` 的 payload。
`docs/evidence/probe2.ts` 就是做这件事的探针。

### 2. 为什么动态内容注入到 user 消息尾部

`_installAgentForcedPromptProjection()` 在请求前会把消息列表里的**所有 system 消息折叠成一条**：

```js
return [head, ...transformed.filter((message) => message.role !== "system")];
```

所以中途插入的 system 消息在 forced prompt 模式下会被丢掉。世界书/状态/记忆因此以
`<roleplay_context>` 文本块**追加到最新 user 消息**的 content 数组尾部：

- projected 之后仍在（不会被折叠）；
- system prompt 保持字节不变 → provider 侧 prompt cache 前缀稳定。

代价：注入块对"用户原话"是可见的附加块，靠 RP 总纲里的 `<lore>` 约定让模型区分
"权威设定"与"用户发言"。

### 3. 工具换装

```ts
function applyRpTools() {
  const active = pi.getActiveTools();
  if (!runtime.previousTools) runtime.previousTools = active.filter(n => !RP_TOOLS.includes(n));
  pi.setActiveTools(RP_TOOLS);
}
```

退出时按 `previousTools` 还原。**踩过的坑**：pi 会把扩展注册的工具默认加入激活集，
于是"没进角色模式"的会话里也会挂着 `rp_state/rp_memory/rp_dice`。因此非角色模式路径必须
显式 `stripRpTools()`（`session_start` 的默认分支、`--no-role`、`/rp off`、以及"flag 指向的角色不存在"）。

另外保留 `tool_call` 兜底拦截：任何非 RP 工具在角色模式下都会被 block，即使别的扩展把编码工具装回来。

### 4. 状态持久化与恢复

- `pi.appendEntry("pi-roleplay-mode", {characterId, at})`：分支级模式记录，`/tree` 导航后按目标分支恢复；
  另有一个**进程内意图**（`/rp off` 之后不会被分支记录"装回来"）。
- `pi.appendEntry("pi-roleplay-state", state)`：角色状态（场景、键值、记忆、回合数），
  按 `characterId` 匹配最后一次有效记录恢复。
- 优先级：`--no-role` > 进程内意图 > `--role` > 分支记录。

### 5. 世界书选条

`selectWorldEntries()`：

1. 扫描文本 = 最近 `scanDepth` 条消息的纯文本拼接（含最新 user 输入），截断到 `scanCharLimit`；
2. 常驻条目（`constant`）恒选；其余条目按关键词命中（支持 `/regex/`、整词、大小写、次级关键词 AND）；
3. 按 `priority` 降序，直到 `maxWorldEntries` 或 `worldTokenBudget`；
4. 预算不足时：**常驻条目截断保留**（丢了等于人设缺一块），**关键词条目整条丢弃**（半截设定更容易误导模型）。

token 估算用 CJK 计 1、其余 4 字符计 1 的启发式（`estimateTokens`），只用于预算，不追求与 tokenizer 一致。

### 6. 压缩

`session_before_compact` 换成剧情向摘要：保留人物关系与称呼、关键事件（承诺/威胁/交换/伤病/得失）、
未收束伏笔、当前时间地点局面、用户角色的明确态度；明确禁止写成任务清单或代码摘要。
状态本身不受压缩影响（存在 session entry 里，压缩只替换消息）。

## 验证方法（可复现）

```bash
V=/tmp/rp-verify
ROOT=$PWD  # 在仓库根目录执行
mkdir -p $V/agent
cp ~/.pi/agent/models.json $V/agent/
cat > $V/agent/settings.json <<EOF
{ "defaultProvider": "deepseek", "defaultModel": "deepseek-flash",
  "extensions": ["$ROOT/src/index.ts"] }
EOF
PI_CODING_AGENT_DIR=$V/agent pi -p "/rp init global"

# 抓最终 provider payload（唯一可信的 prompt/tool 证据）
cat > $V/probe.ts <<'EOF'
import { writeFileSync, mkdirSync } from "node:fs";
export default function (pi) {
  mkdirSync("/tmp/rp-verify/dump", { recursive: true });
  let n = 0;
  pi.on("before_provider_request", async (e) => {
    writeFileSync(`/tmp/rp-verify/dump/payload-${++n}.json`, JSON.stringify(e.payload, null, 2));
  });
}
EOF

PI_CODING_AGENT_DIR=$V/agent pi -e $V/probe.ts --role linyan -p "我先看东西。你验尸时发现了什么？"
# 检查 payload：messages[0].content 应为 RP 提示词；tools 应为 rp_state/rp_memory/rp_dice
```

已用此法验证的行为见 README 的"已验证行为"表。

## 后续可做（未实现）

- 多角色同场景（群聊）：需要把"单角色身份"模型换成多角色卡位 + 轮流发言人；
- 备选开场白/重生成（swipe）：目前只有 `/rp greet n`；
- 世界书 `sticky`/`cooldown`/递归扫描等 ST 高级匹配语义；
- 向量/嵌入召回记忆（当前是朴素词元打分）；
- 立绘/TTS。
