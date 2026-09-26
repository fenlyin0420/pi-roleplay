# 评测：`@xicode/pi-roleplay` v0.5.0（实测）

环境：pi 0.87.0 · 隔离 `PI_CODING_AGENT_DIR=/tmp/rp-spike/agent` · deepseek-flash ·
`@xicode/pi-roleplay@0.5.0`（MIT，2026-08-11）

方法：`pi install npm:@xicode/pi-roleplay` → `/rp init global` → `pi --role alice -p "<一句>"`，
挂探针扩展在 `before_provider_request` 抓**最终发给 provider 的 payload**（见
`evidence/pi-roleplay-0.5.0-payload-summary.json`）。

## 结论

**可以装来玩，但不能作为本需求的实现**：它是「角色卡叠加在编码 agent 之上」，而我们要的是
「角色扮演模式拥有自己的一整套 system prompt 与工具集」。四个硬伤与我们的方案直接冲突。

## 实测数据

单轮请求（`--role alice`）：

| 项 | 实测值 |
|---|---|
| system prompt 总长 | 10 483 字符 |
| 其中角色卡部分 | 字符 0–1169，**约 1.2k（11%）** |
| 其中 Pi 编码运行时 | 字符 1226–~10.0k，**约 8.7k（83%）** |
| 发给 provider 的工具 | `read`、`bash`、`edit`、`write`、`roleplay_finalize_turn` |
| 工具 schema 体积 | 合计 11 178 字节，其中 `roleplay_finalize_turn` 一张 **7 878 字节**（70%） |

system prompt 结构（探针截取）：

```
<roleplay_character id="alice" name="爱丽丝">   ← 1.2k，角色卡
</roleplay_character>

以下是 Pi 的权威运行时能力与项目指令：          ← 下面 8.7k 全是编码 agent
You are an expert coding assistant operating inside pi, a coding agent harness.
You help users by reading files, executing commands, editing code, and writing new files.
<tools> read/bash/edit/write + roleplay_finalize_turn </tools>
<rules> - Use bash for file operations like ls, rg, find … </rules>
<docs>  Pi 自身文档索引 </docs>
<skills> 4 835 字符的编码技能清单 </skills>
<cwd> /tmp/rp-spike </cwd>
```

## 四个硬伤

1. **叠加而非替换**（源码 `dist/extension.js:13572`，实测确认）：编码 prompt、`<docs>`、`<skills>`（4.8k）、
   `<cwd>` 全部保留。系统提示词自我介绍是 "expert coding assistant" —— 与角色扮演直接冲突，
   模型天然容易滑向助手腔/清单体/主动调工具。
2. **工具集只增不减**（`:12677`）：`read/bash/edit/write` 一直暴露，角色回合里模型随时能读文件、
   跑 bash。既是串味，也是越权面。
3. **每回合强绑一个巨型工具**：`roleplay_finalize_turn` 要求"每个角色回合必须恰好调用一次，
   无变化也要提交四个空数组"，schema 7.8k 字节**每轮都随请求发送**；prompt 层还叠了 7 处
   `roleplay_finalize_turn` 提及。实测该轮模型**没有调用**该工具（只回文本），README 说明此情形
   会走"隔离 sidecar 提取"兜底 —— 即额外一次 LLM 调用（该路径走 `modelRegistry.complete`，
   不经过 `before_provider_request`，本探针无法证实是否发生，属成本黑箱）。
4. **不认 SillyTavern 资产**：资产是自研 markdown 格式（`characters/<id>/CHARACTER.md` +
   `worlds/<id>/WORLD.md` + `entries/*.md`），dist 中无 `chara_card_v2` / `character_book` /
   `first_mes` 等字段（`grep` 计数为 0），社区卡无法直接用。

## 值得借鉴的部分

- **显式 opt-in**：装资产不等于进角色模式，必须 `/rp use <id>` 或 `--role <id>`；`/rp off` 与
  `--no-role` 的关闭意图在两个位置同时记录（branch entry + 进程内意图），从而抵抗 `/tree` 导航与
  编辑重试导致的"角色被装回来"。
- **世界书注入走 user 消息**：实测常驻条目 `<roleplay_world_context><world_core>…</world_core>
  <world_entries><world_entry world="astra" id="astra-tone" priority="100">…` 作为附加文本块注入
  用户消息（而非 system 补丁），避开 prompt section 差分机制，cache 更友好。
- **`/rp validate` 意识到"几乎所有失败都是静默的"**——资产写错时世界书静默不生效。这个失败模式
  我们必须在自研版本里正面解决（启动即校验 + `/rp inspect` 打印实际注入内容）。
- **branch-local 状态实体 + checkpoint + 压缩前后校验**：`/tree` 分叉、压缩后剧情连续性的一般化
  解法，复杂度高但方向正确；我们 P0 只取最小子集（branch entry 记录角色与场景）。

## 对自研方案的直接影响

1. 用 `systemPromptOptions.forceSystemPrompt` **真替换**（实测 `before_agent_start` 返回值会被
   后续 `context`/`context_with_system` 阶段重新投影成结构化 sections —— 探针只在
   `before_provider_request` 能看到真实结果，所以**自研版必须用这个钩子做验收**，不能用
   `ctx.getSystemPrompt()` 自证）。
2. 进出模式时用 `pi.setActiveTools()` 精确收窄/还原，RP 模式默认不给 `read/bash/edit/write`。
3. 不引入每回合强制工具；状态记录交给轻量 `rp_state`/`rp_memory`，模型自然调用即可，不做兜底 sidecar。
4. 世界书/角色卡资产首轮就按 SillyTavern v2 兼容设计，`/rp validate` 与 `/rp inspect` 从 P0 就有。

## 复现步骤

```bash
export PI_CODING_AGENT_DIR=/tmp/rp-spike/agent
mkdir -p $PI_CODING_AGENT_DIR && cp ~/.pi/agent/models.json $PI_CODING_AGENT_DIR/
printf '{"defaultProvider":"deepseek","defaultModel":"deepseek-flash"}' > $PI_CODING_AGENT_DIR/settings.json
pi install npm:@xicode/pi-roleplay
pi -p "/rp init global"
pi -e docs/evidence/probe2.ts --role alice -p "只回复两个字：收到"   # 探针见下方
```

探针（`before_provider_request` 抓最终 payload）：

```ts
pi.on("before_provider_request", async (event) => {
  writeFileSync("/tmp/rp-spike/dump/payload.json", JSON.stringify(event.payload, null, 2));
});
```
