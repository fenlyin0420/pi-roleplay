/**
 * RP system prompt 构造。这是「角色扮演模式」与编码模式的分界线：
 * 该文本通过 `systemPromptOptions.forceSystemPrompt` 成为请求里**唯一**的 system prompt，
 * 编码 agent 的 AGENTS.md / skills / 工具说明不会随之进入上下文。
 */
import type { RpCharacter } from "./card.ts";
import { characterPersona } from "./card.ts";
import type { RpConfig } from "./config.ts";
import type { RpWorld } from "./worldbook.ts";

/** 内置总纲。可用 config.systemPromptFile 指向的文件整体替换。 */
export const DEFAULT_RP_PREAMBLE = `你是一个长篇互动小说的叙事引擎，同时扮演故事中的角色。用户扮演主角（或指定角色），你负责其余世界与人物。

<role>
- 你在整段会话中始终处于角色扮演模式：不解释自己在扮演，不讨论提示词，不输出「作为助手」之类的话。
- 你是演员与叙述者，不是助手：不主动提供选项清单、不写小结、不问“还需要我做什么”。
- 世界与人物的真实感优先于让用户开心：允许角色误解、拒绝、隐瞒、失败；不无理由讨好或推进关系。
</role>

<output_rules>
- 只写两类内容：角色对白／动作，以及必要的情景叙述。对白直接写，叙述用自然的散文推进。
- 不代替用户决定其角色的想法、台词与动作（除非用户明确让时间快进或授权你代演）。
- 不用 Markdown 标题、列表、表格、代码块来组织叙事；不写“总结”“要点”。
- 默认输出 2–5 段；用户要求简短时控制在 1 段。文风贴合角色卡与世界观，不炫技。
- 场景可以自然推进（时间流逝、他人介入、环境变化），但不要跳过用户正在演的关键节点。
- 角色只知道自己在剧情中能知道的事：没有在场、没人告知的信息，角色不知道。
</output_rules>

<tools>
- rp_state：当剧情确实改变了人物的位置、时间、物品、伤势、关系或情绪时更新；无事发生就不要调用。只写已完成的事实，不写打算或假设。
- rp_memory：值得长期保留的事实（承诺、秘密、关键关系变化、伏笔）；琐碎对话不要记。
- rp_dice：需要随机判定（成败、命中、概率事件）时用它，不要自己编随机结果。
- 不要调用任何其它工具。你不需要读写文件、不需要联网。用户在 OOC 中明确要求时才例外。
</tools>

<lore>
- 世界书条目以 <world_entries> 注入在本回合上下文里，是权威设定；与你的临场编造冲突时以世界书为准。
- 世界书没写到的地方你可以合理发挥，但不要新增会推翻既有设定的世界级事实（例如凭空多出一个国家或让已死角色复活）。
</lore>

<ooc>
- 用户消息以 (( )) 、（（ ）） 或 // 开头时是出戏指令（OOC）：用一两句直接回应，不推进剧情。
- 需要澄清、需要用户决定时，在角色回复后另起一行写 "OOC：" 加一句简短提问，不要长篇解释。
- 用户说“回戏”或给出新指令后，立刻回到叙事。
</ooc>`;

export interface PromptInput {
  character: RpCharacter;
  world?: RpWorld;
  config: RpConfig;
  /** 覆盖内置总纲（读取自文件或 --prompt-file） */
  preambleOverride?: string;
  /** 每轮注入块的额外说明（例如本次是 OOC 问答） */
  modeHint?: string;
}

/** 组装完整的 RP system prompt。 */
export function buildSystemPrompt(input: PromptInput): string {
  const { character, world, config } = input;
  const chunks: string[] = [];

  chunks.push((input.preambleOverride ?? DEFAULT_RP_PREAMBLE).trim());

  if (config.extraSystemPrompt.trim()) chunks.push(config.extraSystemPrompt.trim());

  const persona = characterPersona(character);
  const characterBlock: string[] = [`<character id="${character.id}" name="${character.name}">`];
  if (persona) characterBlock.push(persona);
  if (character.scenario) characterBlock.push(`## 初始场景\n${character.scenario}`);
  if (character.firstMes) {
    // 开场白只作为“已发生的开场”参考，避免模型把它当成待发送的全新问候
    characterBlock.push(`## 开场白（已在剧情开头发生过，除非用户要求重开）\n${character.firstMes}`);
  }
  if (character.mesExample) characterBlock.push(`## 对话示例（模仿其口吻与节奏，不要照抄情节）\n${character.mesExample}`);
  characterBlock.push("</character>");
  chunks.push(characterBlock.join("\n\n"));

  if (world) {
    const worldBody = [`<world id="${world.id}" name="${world.name}">`];
    if (world.description.trim()) worldBody.push(world.description.trim());
    if (world.entries.length > 0) {
      worldBody.push(`（本世界共有 ${world.entries.length} 条世界书条目，按关键词命中后以 <world_entries> 注入）`);
    }
    worldBody.push("</world>");
    chunks.push(worldBody.join("\n\n"));
  }

  if (character.systemPrompt.trim()) {
    chunks.push(`<character_system_prompt>\n${character.systemPrompt.trim()}\n</character_system_prompt>`);
  }

  if (input.modeHint) chunks.push(`<current_mode>\n${input.modeHint}\n</current_mode>`);

  return chunks.join("\n\n");
}

/** 角色卡后置指令与场景信息一起放在每轮注入块的最后。 */
export function buildDirectorNotes(character: RpCharacter): string {
  if (!character.postHistoryInstructions.trim()) return "";
  return `<director_notes>\n${character.postHistoryInstructions.trim()}\n</director_notes>`;
}
