# SillyTavern 兼容性

## 角色卡

| ST 字段 | pi-roleplay 映射 | 说明 |
|---|---|---|
| `spec` / `spec_version` | — | v1（无 spec）/ v2 / v3 均可解析，v3 与 v2 字段同名 |
| `data.name` | `character.name` | 必填（缺失则回退 id） |
| `data.description` | 角色块正文 | 身份/外貌/背景，进入 RP system prompt |
| `data.personality` | `## 性格` 段 | 同上 |
| `data.scenario` | `## 初始场景` | 同上 |
| `data.first_mes` | 开场白 | 同时进入 system prompt 与入戏时的开场消息 |
| `data.alternate_greetings[]` | 备选开场白 | `/rp greet 2`、`/rp greet 3` … |
| `data.mes_example` | `## 对话示例` | 提示"模仿口吻、不要照抄情节" |
| `data.system_prompt` | `<character_system_prompt>` | 拼在 RP 总纲与角色块之后 |
| `data.post_history_instructions` | `<director_notes>` | 放在每轮注入块末尾（等价 ST 的 post-history） |
| `data.creator_notes` / `data.tags` | 元数据 | `/rp inspect character` 展示 |
| `data.extensions.world` | 世界绑定 | 也接受 `data.world` / `data.world_id` |
| `data.character_book` | 内嵌世界书（id `<角色>-book`） | 与显式绑定的世界**同时**注入，互不覆盖 |
| PNG `chara` / `ccv3` tEXt/iTXt/zTXt 块 | 角色卡 JSON | base64 或裸 JSON 都支持；`ccv3` 优先 |

## 世界书（World Info）

| ST 字段 | 映射 | 说明 |
|---|---|---|
| `key` / `keys` | `keys` | 关键词数组 |
| `keysecondary` | `secondaryKeys` | 存在时要求**同时**命中（AND） |
| `content` | `content` | 注入正文 |
| `comment` | `title` | 展示用标题 |
| `constant` | `constant` | 恒注入 |
| `order` | `priority` | 降序排列 |
| `disable` | `disabled` | 跳过 |
| `caseSensitive` | `caseSensitive` | 默认 false |
| `matchWholeWords` | `wholeWord` | 仅对 ASCII 关键词生效 |
| `uid` / `id` | 条目 id 后缀 | 生成 `<worldId>-<slug>` |

## 不支持（明确说明，避免踩坑）

- `position` / `depth`：ST 用 0–5 表达注入位置（角色定义前/后、作者注等）。本扩展统一注入到
  `<roleplay_context>` 块里（追加在最新 user 消息尾部），不接受逐条目位置覆盖。
- `sticky` / `cooldown` / `delay` / `probability` / `group` / `groupWeight` / `useGroupScoring`：
  概率与调度类语义未实现——目前只按关键词与预算选条。
- `vectorized` / `automationId`：向量召回与自动化未实现（记忆召回是朴素词元打分）。
- 递归扫描（`excludeRecursion` / `preventRecursion` / `delayUntilRecursion`）：未实现。
  命中与否只看最近 `scanDepth` 条消息，不把注入结果回喂给匹配。
- `role`（条目以 user/assistant 角色注入）：统一按设定块处理。
- 群聊/多角色卡（`characters` 数组与群组世界书）：本扩展是单角色身份模型。

## 迁移建议

- 想用社区卡：`/rp import ~/Downloads/某卡.png` → `/rp validate` → `/rp list`。
- ST 的 `position: before_char` 类条目，最接近的等价做法是改成 `constant: true`（恒注入），
  但要注意 token 预算（`worldTokenBudget`）。
- ST 的"角色绑定的世界书"通常已嵌入卡里（`character_book`），导入卡即可，无需单独搬世界书。
