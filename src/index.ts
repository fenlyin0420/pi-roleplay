/**
 * pi-roleplay —— Pi 的角色扮演模式。
 *
 * 设计要点（详见 docs/DESIGN.md）：
 * 1. 整套替换：进入模式后 `systemPromptOptions.forceSystemPrompt` 成为请求里唯一的 system prompt，
 *    编码 agent 的 AGENTS.md / skills / 工具说明不进上下文。
 * 2. 工具换装：`pi.setActiveTools()` 精确换成 RP 工具集，退出时原样还原；另有 `tool_call` 兜底拦截。
 * 3. 动态内容走 user 消息尾部：世界书命中、状态、记忆以 <roleplay_context> 追加到最新 user 消息，
 *    既避开 forced prompt 对中途 system 消息的折叠，也保住 system prompt 的缓存前缀。
 * 4. 状态随 session entry 持久化，`/tree` 分叉与压缩后仍可恢复。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import {
  convertToLlm,
  getAgentDir,
  serializeConversation,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { assetRoots, examplesDir, installExamples, loadAssets, type RpAssets, type RpDiagnostic } from "./assets.ts";
import type { RpCharacter } from "./card.ts";
import { loadConfig, type RpConfig } from "./config.ts";
import { buildDirectorNotes, buildSystemPrompt } from "./prompt.ts";
import { createState, renderTurnContext, type RpSessionState } from "./state.ts";
import { estimateTokens } from "./text.ts";
import { registerRoleplayTools } from "./tools.ts";
import { selectWorldEntries, type RpWorldEntry } from "./worldbook.ts";

/** 角色模式下激活的工具集 */
const RP_TOOLS = ["rp_state", "rp_memory", "rp_dice"];
/** 进入角色模式前的默认编码工具集（还原兜底） */
const DEFAULT_CODE_TOOLS = ["read", "bash", "edit", "write"];
const MODE_ENTRY = "pi-roleplay-mode";
const STATE_ENTRY = "pi-roleplay-state";

interface ModeEntry {
  characterId: string | null;
  at: number;
}

/** context 事件里我们只关心 role 与 content，其余字段原样回写。 */
type RpMessage = { role?: string; content?: unknown };

interface Runtime {
  characterId?: string;
  state?: RpSessionState;
  /** 进入模式前的工具集，退出时还原 */
  previousTools?: string[];
  /** 本进程内的显式意图：/rp use 后跨 session 保持，/rp off 后不会被分支记录装回来 */
  intent?: "on" | "off";
  /** 最近一次注入的世界书条目与 token，供 /rp inspect */
  lastInjection?: { worldIds: string[]; tokens: number; scanChars: number; at: number };
}

export default function roleplayExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const runtime: Runtime = {};

  let config: RpConfig;
  let configSources: string[] = [];
  let assets: RpAssets;
  let assetsCwd = "";

  // ── 资产与配置 ────────────────────────────────────────────────────────────
  function ensureAssets(ctx: ExtensionContext, force = false): RpAssets {
    if (!force && assets && assetsCwd === ctx.cwd) return assets;
    const loaded = loadConfig(agentDir, ctx.cwd);
    config = loaded.config;
    configSources = loaded.sources;
    assets = loadAssets(agentDir, ctx.cwd);
    assetsCwd = ctx.cwd;
    return assets;
  }

  function character(): RpCharacter | undefined {
    return runtime.characterId ? assets?.characters.get(runtime.characterId) : undefined;
  }

  function worldEntriesFor(char: RpCharacter): RpWorldEntry[] {
    const entries: RpWorldEntry[] = [];
    if (char.worldId) {
      const world = assets.worlds.get(char.worldId);
      if (world) entries.push(...world.entries);
    }
    for (const [id, world] of assets.worlds) {
      if (id === char.worldId) continue;
      if (char.embeddedWorld && id === `${char.id}-book`) entries.push(...world.entries);
    }
    return entries;
  }

  // ── 提示与状态输出 ────────────────────────────────────────────────────────
  function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
    ctx.ui.notify(message, level);
  }

  function updateStatus(ctx: ExtensionContext): void {
    const char = character();
    ctx.ui.setStatus("roleplay", char ? ctx.ui.theme.fg("accent", `🎭 ${char.name}`) : undefined);
  }

  function diagnosticsText(items: readonly RpDiagnostic[]): string {
    if (items.length === 0) return "资产校验通过，没有发现可疑之处。";
    const order = { error: 0, warning: 1, info: 2 } as const;
    const label = { error: "错误", warning: "警告", info: "提示" } as const;
    return [...items]
      .sort((a, b) => order[a.level] - order[b.level])
      .map((item) => `[${label[item.level]}] ${item.message}${item.fix ? `\n    → ${item.fix}` : ""}`)
      .join("\n");
  }

  /** 长输出落盘后只回路径（手机端友好）。 */
  function dump(text: string, name: string): string {
    const dir = join(agentDir, "roleplay", "dump");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(path, text, "utf8");
    return path;
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────
  function persistMode(): void {
    pi.appendEntry(MODE_ENTRY, { characterId: runtime.characterId ?? null, at: Date.now() } satisfies ModeEntry);
  }

  function persistState(): void {
    if (runtime.state) pi.appendEntry(STATE_ENTRY, runtime.state);
  }

  function readEntries(ctx: ExtensionContext): Array<{ type?: string; customType?: string; data?: unknown }> {
    return ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
  }

  function lastModeEntry(ctx: ExtensionContext): ModeEntry | undefined {
    const entries = readEntries(ctx).filter((entry) => entry.type === "custom" && entry.customType === MODE_ENTRY);
    const last = entries[entries.length - 1];
    return last?.data as ModeEntry | undefined;
  }

  function lastStateEntry(ctx: ExtensionContext, characterId: string): RpSessionState | undefined {
    const entries = readEntries(ctx).filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY);
    for (let i = entries.length - 1; i >= 0; i--) {
      const data = entries[i].data as RpSessionState | undefined;
      if (data && data.characterId === characterId) return data;
    }
    return undefined;
  }

  // ── 工具换装 ──────────────────────────────────────────────────────────────
  function applyRpTools(): void {
    const active = pi.getActiveTools();
    if (!runtime.previousTools) runtime.previousTools = active.filter((name) => !RP_TOOLS.includes(name));
    pi.setActiveTools(RP_TOOLS);
  }

  /** Pi 会把扩展注册的工具默认加入激活集，所以非角色模式必须显式摘掉，避免污染编码会话。 */
  function stripRpTools(): void {
    const active = pi.getActiveTools();
    const filtered = active.filter((name) => !RP_TOOLS.includes(name));
    if (filtered.length !== active.length) pi.setActiveTools(filtered);
  }

  /**
   * 角色模式下工具集必须**恰好**是 RP_TOOLS。
   * 别的扩展可能在我们的 session_start 之后又把自己的工具装回来（实测 subagent_supervisor、mcp），
   * 所以每轮 before_agent_start 都重新对齐一次（此处 setActiveTools 对本次运行是权威的）。
   */
  function enforceRpTools(): void {
    const active = pi.getActiveTools();
    if (active.length === RP_TOOLS.length && RP_TOOLS.every((name) => active.includes(name))) return;
    pi.setActiveTools(RP_TOOLS);
  }

  function restoreTools(): void {
    const restore = (runtime.previousTools ?? DEFAULT_CODE_TOOLS).filter((name) => !RP_TOOLS.includes(name));
    pi.setActiveTools(restore.length > 0 ? restore : DEFAULT_CODE_TOOLS);
    runtime.previousTools = undefined;
  }

  // ── 模式开关 ──────────────────────────────────────────────────────────────
  function enterMode(ctx: ExtensionContext, characterId: string, options: { silent?: boolean } = {}): boolean {
    const char = assets.characters.get(characterId);
    if (!char) {
      const available = [...assets.characters.keys()];
      notify(
        ctx,
        available.length > 0
          ? `找不到角色 \"${characterId}\"。可用：${available.join(", ")}`
          : `找不到角色 \"${characterId}\"，资产目录里也没有角色卡（先跑 /rp init global 或 /rp import <文件>）。`,
        "error",
      );
      return false;
    }

    const restored = lastStateEntry(ctx, characterId);
    runtime.characterId = characterId;
    runtime.state = restored ?? createState(characterId);
    runtime.intent = "on";
    runtime.lastInjection = undefined;
    applyRpTools();
    persistMode();
    updateStatus(ctx);

    const greeting = !restored && config.autoGreet && char.firstMes.trim() ? char.firstMes.trim() : undefined;
    if (!options.silent) {
      const lines = [
        `已进入角色模式：${char.name}（${char.id}）`,
        `世界：${char.worldId ?? "未绑定"}`,
        `工具：${RP_TOOLS.join(" / ")}`,
        restored ? "已从本分支恢复剧情状态。" : "新剧情开始。",
      ];
      notify(ctx, lines.join("\n"));
    }
    if (greeting) {
      if (runtime.state) runtime.state.greetIndex = 0;
      // 开场白以带标记的 custom message 呈现：既能被用户看到（TUI 与手机端一致），
      // 又不会被模型误当作用户的台词。文本本身已在 RP system prompt 的角色块里。
      pi.sendMessage(
        { customType: "roleplay-greeting", content: `（已发生的开场，非用户发言）\n\n${greeting}`, display: true },
        { triggerTurn: false },
      );
    }
    return true;
  }

  function exitMode(ctx: ExtensionContext, options: { silent?: boolean } = {}): void {
    const had = runtime.characterId;
    runtime.characterId = undefined;
    runtime.state = undefined;
    runtime.intent = "off";
    runtime.lastInjection = undefined;
    restoreTools();
    persistMode();
    updateStatus(ctx);
    if (!options.silent) {
      notify(ctx, had ? `已退出角色模式（${had}）。编码模式与工具已恢复。` : "当前不在角色模式。");
    }
  }

  function resolveOnSessionStart(ctx: ExtensionContext): void {
    const roleFlag = pi.getFlag("role");
    const noRole = pi.getFlag("no-role") === true;

    if (noRole) {
      runtime.intent = "off";
      exitMode(ctx, { silent: true });
      return;
    }
    if (runtime.intent === "off") {
      exitMode(ctx, { silent: true });
      return;
    }

    const target =
      (runtime.intent === "on" ? runtime.characterId : undefined) ??
      (typeof roleFlag === "string" && roleFlag.trim() ? roleFlag.trim() : undefined) ??
      lastModeEntry(ctx)?.characterId ??
      undefined;

    if (target) {
      if (!enterMode(ctx, target, { silent: true })) stripRpTools();
    } else {
      runtime.characterId = undefined;
      runtime.state = undefined;
      runtime.previousTools = undefined;
      stripRpTools();
      updateStatus(ctx);
    }
  }

  // ── 每轮注入 ──────────────────────────────────────────────────────────────
  function buildScanText(messages: readonly RpMessage[]): string {
    const depth = Math.max(1, config.scanDepth);
    const recent = messages.slice(-depth);
    const parts: string[] = [];
    for (const message of recent) {
      const content = message.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content as Array<{ type?: string; text?: string }>) {
          if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
        }
      }
    }
    return parts.join("\n").slice(-config.scanCharLimit);
  }

  function buildInjection(ctx: ExtensionContext, messages: readonly RpMessage[]): string | undefined {
    const char = character();
    if (!char || !runtime.state) return undefined;

    const scanText = buildScanText(messages);
    const selection = selectWorldEntries(
      worldEntriesFor(char),
      { scanText },
      { budgetTokens: config.worldTokenBudget, maxEntries: config.maxWorldEntries },
    );

    const base = renderTurnContext({
      character: char,
      state: runtime.state,
      worldEntries: selection.selected,
      memoryLimit: config.memoryLimit,
      includeState: true,
    });
    const notes = buildDirectorNotes(char);
    const text = [base, notes].filter(Boolean).join("\n\n");
    if (!text) return undefined;

    runtime.lastInjection = {
      worldIds: selection.selected.map((entry) => entry.id),
      tokens: estimateTokens(text),
      scanChars: scanText.length,
      at: Date.now(),
    };
    return text;
  }

  function appendToLastUser(messages: readonly RpMessage[], block: string): RpMessage[] {
    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i--) {
      const message = next[i] as { role?: string; content?: unknown };
      if (message?.role !== "user") continue;
      const content = message.content;
      const merged =
        typeof content === "string"
          ? [{ type: "text", text: content }, { type: "text", text: block }]
          : Array.isArray(content)
            ? [...content, { type: "text", text: block }]
            : [{ type: "text", text: block }];
      next[i] = { ...message, content: merged };
      return next;
    }
    // 没有 user 消息（例如开场触发）：追加一条 user 消息承载上下文
    next.push({ role: "user", content: [{ type: "text", text: block }] });
    return next;
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    ensureAssets(ctx, true);
    runtime.lastInjection = undefined;
    resolveOnSessionStart(ctx);
    if (event.reason === "startup" || event.reason === "resume") {
      const problems = assets.diagnostics.filter((item) => item.level === "error");
      if (problems.length > 0) {
        notify(ctx, `角色资产有 ${problems.length} 个错误，用 /rp validate 查看。`, "warning");
      }
    }
  });

  // /tree 导航：模式与状态跟随目标分支的记录
  pi.on("session_tree", async (_event, ctx) => {
    ensureAssets(ctx);
    resolveOnSessionStart(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const char = character();
    if (!char || !runtime.state) return undefined;
    ensureAssets(ctx);
    enforceRpTools();

    const world = char.worldId ? assets.worlds.get(char.worldId) : undefined;
    const systemPrompt = buildSystemPrompt({
      character: char,
      world,
      config,
      preambleOverride: readPromptOverride(ctx.cwd),
    });

    // 双保险：文档里 returning systemPrompt 与 forceSystemPrompt 都表示“整套替换”，
    // 两条路径都写上，避免不同 pi 版本走不同分支时结果不一致。
    event.systemPromptOptions.forceSystemPrompt = systemPrompt;
    return { systemPrompt };
  });

  pi.on("context", async (event, ctx) => {
    if (!runtime.characterId) return undefined;
    const messages = event.messages as unknown as RpMessage[];
    if (messages.length === 0) return undefined;
    const block = buildInjection(ctx, messages);
    if (!block) return undefined;
    return { messages: appendToLastUser(messages, block) as unknown as typeof event.messages };
  });

  // 兜底：角色模式下不给任何非 RP 工具开门（防止其它扩展/技能把编码工具装回来）
  pi.on("tool_call", async (event) => {
    if (!runtime.characterId) return undefined;
    if (RP_TOOLS.includes(event.toolName)) return undefined;
    return { block: true, reason: `角色模式进行中：${event.toolName} 已停用（用 /rp off 退出角色模式后再用）。` };
  });

  pi.on("agent_end", async () => {
    if (!runtime.state) return;
    runtime.state.turns += 1;
    if (runtime.state.turns % 5 === 0) persistState();
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const char = character();
    if (!char || !runtime.state) return undefined;
    const { preparation, signal } = event;
    const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    if (messages.length === 0) return undefined;

    const conversation = serializeConversation(convertToLlm(messages));
    const model = ctx.model;
    if (!model) return undefined;

    const prompt = `你是长篇互动小说的档案管理员。把下面的角色扮演会话压缩成一份**剧情摘要**，让故事可以在不读原文的情况下无损续写。

必须保留：
1. 在场人物及其身份/关系/称呼，人物外貌或处境的变化；
2. 已发生的关键事件（按时间顺序），包括承诺、威胁、交换、伤病、得失物品；
3. 未收束的伏笔、悬念、双方未说破的心思；
4. 当前时间、地点、局面（谁在哪里、正打算做什么）；
5. 主角（用户扮演角色）已表现出的明确态度与已知信息。

不要做的事：
- 不要写成代码任务清单、待办列表或技术总结；
- 不要复述对话原文，不要保留临场修辞；
- 不要添加原文没有发生的事。

当前角色：${char.name}（${char.id}）
场景记录：${runtime.state.scene ?? "（未记录）"}

<conversation>
${conversation}
</conversation>`;

    try {
      const response = await ctx.modelRegistry.complete(
        model,
        { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
        { maxTokens: 2048, signal, cacheRetention: "none" },
      );
      const summary = response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!summary) return undefined;
      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          usage: response.usage,
        },
      };
    } catch (error) {
      notify(ctx, `剧情压缩失败，回退默认压缩：${error instanceof Error ? error.message : String(error)}`, "warning");
      return undefined;
    }
  });

  pi.on("session_shutdown", async () => {
    runtime.previousTools = undefined;
  });

  // ── 工具与命令 ────────────────────────────────────────────────────────────
  registerRoleplayTools(pi, {
    current: () => runtime.state,
    commit: (state, reason) => {
      runtime.state = state;
      pi.appendEntry(STATE_ENTRY, state);
      void reason;
    },
    characterName: () => character()?.name ?? "",
    memoryCap: () => config.memoryCap,
  });

  pi.registerFlag("role", { description: "启动即进入角色模式：--role <角色 id>", type: "string" });
  pi.registerFlag("no-role", { description: "本次启动强制不进入角色模式（优先级最高）", type: "boolean", default: false });

  pi.registerCommand("rp", {
    description: "角色扮演模式：/rp use <id> | off | status | list | inspect | validate | greet | ooc | import | init | reload",
    getArgumentCompletions: (prefix: string) => {
      const subs = ["use", "off", "status", "list", "inspect", "validate", "greet", "ooc", "import", "init", "reload"];
      const ids = assets ? [...assets.characters.keys()] : [];
      const items = [...subs, ...ids]
        .filter((item) => item.startsWith(prefix))
        .map((item) => ({ value: item, label: item }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      ensureAssets(ctx);
      const [sub, ...rest] = args.trim().split(/\s+/);
      const restText = rest.join(" ").trim();

      switch (sub) {
        case undefined:
        case "":
        case "status": {
          const char = character();
          if (!char || !runtime.state) {
            notify(ctx, `角色模式：未启用\n可用角色：${[...assets.characters.keys()].join(", ") || "（无，先 /rp init global）"}`);
            return;
          }
          const injection = runtime.lastInjection;
          const lines = [
            `角色：${char.name}（${char.id}）`,
            `世界：${char.worldId ?? "未绑定"}`,
            `状态：${Object.keys(runtime.state.vars).length} 项 · 记忆 ${runtime.state.memories.length} 条 · 回合 ${runtime.state.turns}`,
            `场景：${runtime.state.scene ?? "（未设定）"}`,
            `工具：${pi.getActiveTools().join(", ")}`,
            injection
              ? `上轮注入：世界书 ${injection.worldIds.length} 条 / 约 ${injection.tokens} tokens（扫描 ${injection.scanChars} 字符）`
              : "上轮注入：尚未发生（下一条消息后可见）",
            `资产：${assets.roots.map((root) => `${root}${existsSync(root) ? "" : "(缺失)"}`).join("  ·  ")}`,
          ];
          notify(ctx, lines.join("\n"));
          return;
        }

        case "list": {
          const characters = [...assets.characters.values()];
          const worlds = [...assets.worlds.values()];
          const characterLines = characters.map(
            (char) => `- ${char.id} — ${char.name}${char.worldId ? ` @${char.worldId}` : ""} [${basename(char.source)}]`,
          );
          const worldLines = worlds.map((world) => `- ${world.id} — ${world.name}（${world.entries.length} 条）`);
          notify(
            ctx,
            [`角色（${characters.length}）：`, ...(characterLines.length ? characterLines : ["- （空）"]), "", `世界（${worlds.length}）：`, ...(worldLines.length ? worldLines : ["- （空）"])].join("\n"),
          );
          return;
        }

        case "use":
        case "on": {
          if (!restText) {
            notify(ctx, `用法：/rp use <角色 id>\n可用：${[...assets.characters.keys()].join(", ") || "（无）"}`, "warning");
            return;
          }
          if (runtime.characterId && runtime.characterId !== restText) {
            notify(ctx, `当前已在 ${runtime.characterId} 的剧情中。先 /rp off 再切换角色（同一会话不支持热切换）。`, "warning");
            return;
          }
          enterMode(ctx, restText);
          return;
        }

        case "off": {
          exitMode(ctx);
          return;
        }

        case "greet": {
          const char = character();
          if (!char || !runtime.state) {
            notify(ctx, "先 /rp use <角色 id> 进入角色模式。", "warning");
            return;
          }
          const greetings = [char.firstMes, ...char.alternateGreetings].filter((item) => item.trim());
          if (greetings.length === 0) {
            notify(ctx, "这张卡没有开场白。", "warning");
            return;
          }
          const index = restText ? Math.max(0, Number(restText) - 1) : runtime.state.greetIndex;
          const text = greetings[Math.min(index, greetings.length - 1)];
          runtime.state.greetIndex = index;
          pi.sendMessage(
            { customType: "roleplay-greeting", content: `（已发生的开场，非用户发言）\n\n${text}`, display: true },
            { triggerTurn: false },
          );
          notify(ctx, `已发送第 ${index + 1}/${greetings.length} 条开场白。`);
          return;
        }

        case "ooc": {
          if (!runtime.characterId) {
            notify(ctx, "先 /rp use <角色 id>。", "warning");
            return;
          }
          if (!restText) {
            notify(ctx, "用法：/rp ooc <出戏问题或指令>", "warning");
            return;
          }
          pi.sendUserMessage(`((OOC：${restText}))`);
          return;
        }

        case "inspect": {
          const target = restText || "status";
          const char = character();
          if (target === "system") {
            if (!char) {
              notify(ctx, "未进入角色模式，没有 RP system prompt。", "warning");
              return;
            }
            const world = char.worldId ? assets.worlds.get(char.worldId) : undefined;
            const text = buildSystemPrompt({
              character: char,
              world,
              config,
              preambleOverride: readPromptOverride(ctx.cwd),
            });
            const path = dump(
              [
                `# RP system prompt（${char.name}）`,
                "",
                `- 长度：${text.length} 字符 / 约 ${estimateTokens(text)} tokens`,
                `- 配置来源：${configSources.join(", ") || "默认值"}`,
                "",
                "```text",
                text,
                "```",
              ].join("\n"),
              "system-prompt",
            );
            notify(ctx, `RP system prompt 已写入 ${path}`);
            return;
          }
          if (target === "world") {
            if (!char) {
              notify(ctx, "未进入角色模式。", "warning");
              return;
            }
            const entries = worldEntriesFor(char);
            const injection = runtime.lastInjection;
            const header = injection
              ? `上轮注入 ${injection.worldIds.length} 条：${injection.worldIds.join(", ")}`
              : "上轮尚未注入。";
            const body = entries.map((entry) => `- ${entry.id}｜${entry.constant ? "常驻" : `关键词 ${entry.keys.join("/")}`}｜priority ${entry.priority}`).join("\n");
            notify(ctx, `${header}\n全部条目（${entries.length}）：\n${body || "（无）"}`);
            return;
          }
          if (target === "state") {
            if (!runtime.state) {
              notify(ctx, "未进入角色模式。", "warning");
              return;
            }
            const state = runtime.state;
            const vars = Object.entries(state.vars).map(([key, value]) => `- ${key}：${value}`);
            const memories = state.memories.slice(-20).map((memory) => `- ${memory.text}`);
            notify(
              ctx,
              [`场景：${state.scene ?? "（未设定）"}`, "", "状态项：", ...(vars.length ? vars : ["- （空）"]), "", "最近记忆：", ...(memories.length ? memories : ["- （空）"])].join("\n"),
            );
            return;
          }
          if (target === "config") {
            notify(ctx, JSON.stringify({ ...config, sources: configSources }, null, 2));
            return;
          }
          if (!char) {
            notify(ctx, "未进入角色模式。可用：/rp inspect system|world|state|config|character", "warning");
            return;
          }
          notify(
            ctx,
            [
              `角色卡来源：${char.source}`,
              `名称：${char.name}`,
              `标签：${char.tags.join(", ") || "（无）"}`,
              `描述：${char.description.slice(0, 200) || "（空）"}`,
              `性格：${char.personality.slice(0, 200) || "（空）"}`,
              `场景：${char.scenario.slice(0, 200) || "（空）"}`,
              `开场白：${char.firstMes.slice(0, 200) || "（空）"}（备选 ${char.alternateGreetings.length} 条）`,
              `示例对话：${char.mesExample.slice(0, 120) || "（空）"}`,
              `卡自带 system prompt：${char.systemPrompt.slice(0, 160) || "（无）"}`,
              `后置指令：${char.postHistoryInstructions.slice(0, 160) || "（无）"}`,
            ].join("\n"),
          );
          return;
        }

        case "validate": {
          const target = restText || undefined;
          if (target && !assets.characters.has(target) && !assets.worlds.has(target)) {
            notify(ctx, `没有名为 ${target} 的角色或世界。`, "error");
            return;
          }
          const items = target
            ? assets.diagnostics.filter((item) => item.message.includes(target) || item.path?.includes(target))
            : assets.diagnostics;
          const header = `资产目录：\n${assets.roots.map((root) => `  ${root}`).join("\n")}\n\n`;
          notify(ctx, header + diagnosticsText(items));
          return;
        }

        case "reload": {
          ensureAssets(ctx, true);
          if (runtime.characterId) enterMode(ctx, runtime.characterId, { silent: true });
          notify(
            ctx,
            `已重新加载资产：角色 ${assets.characters.size} 张、世界 ${assets.worlds.size} 个；诊断 ${assets.diagnostics.length} 条。`,
          );
          return;
        }

        case "init": {
          const scope = restText === "project" ? "project" : "global";
          const root = scope === "project" ? join(ctx.cwd, ".pi", "roleplay") : join(agentDir, "roleplay");
          mkdirSync(root, { recursive: true });
          const result = installExamples(root);
          notify(
            ctx,
            [
              `示例资产已安装到 ${root}（来源 ${examplesDir()}）`,
              `新增：${result.copied.length} 项`,
              result.skipped.length > 0 ? `跳过（已存在）：${result.skipped.map((path) => basename(path)).join(", ")}` : "",
              "安装不会自动进入角色模式；用 /rp list 看清单，/rp use <id> 进入。",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          ensureAssets(ctx, true);
          return;
        }

        case "import": {
          if (!restText) {
            notify(ctx, "用法：/rp import <角色卡文件路径 或 世界书 JSON 路径>", "warning");
            return;
          }
          const source = restText.replace(/^~(?=\/)/, process.env.HOME ?? "~");
          if (!existsSync(source)) {
            notify(ctx, `文件不存在：${source}`, "error");
            return;
          }
          const isWorldJson = /world|lore|book/i.test(basename(source));
          const root = join(agentDir, "roleplay");
          const targetDir = join(root, isWorldJson ? "worlds" : "characters");
          mkdirSync(targetDir, { recursive: true });
          const name = basename(source);
          const targetPath = join(targetDir, name);
          if (existsSync(targetPath)) {
            notify(ctx, `目标已存在，未覆盖：${targetPath}`, "warning");
            return;
          }
          writeFileSync(targetPath, readFileSync(source));
          ensureAssets(ctx, true);
          notify(ctx, `已导入 → ${targetPath}\n用 /rp validate 校验，/rp list 查看。`);
          return;
        }

        case "help": {
          notify(ctx, HELP_TEXT);
          return;
        }

        default: {
          // 允许 /rp alice 这种简写
          if (assets.characters.has(sub)) {
            enterMode(ctx, sub);
            return;
          }
          notify(ctx, `未知子命令 "${sub}"。\n\n${HELP_TEXT}`, "warning");
          return;
        }
      }
    },
  });

  pi.registerShortcut(Key.ctrlAlt("r"), {
    description: "切换角色扮演模式",
    handler: async (ctx) => {
      ensureAssets(ctx);
      if (runtime.characterId) {
        exitMode(ctx);
        return;
      }
      const target = [...assets.characters.keys()][0];
      if (!target) {
        notify(ctx, "资产目录里没有角色卡，先 /rp init global 或 /rp import <文件>。", "warning");
        return;
      }
      enterMode(ctx, target);
    },
  });

  const HELP_TEXT = [
    "角色扮演模式：",
    "  /rp use <id>        进入角色（同一会话不热切换角色）",
    "  /rp off             退出，恢复编码模式与工具",
    "  /rp status          当前角色 / 场景 / 工具 / 上轮注入",
    "  /rp list            列出角色与世界",
    "  /rp inspect [character|system|world|state|config]",
    "  /rp greet [n]       重发第 n 条开场白（1 = 首条）",
    "  /rp ooc <内容>      以出戏身份说一句",
    "  /rp import <文件>   导入 ST 角色卡（json/png）或世界书 json",
    "  /rp init [global|project]  安装示例资产",
    "  /rp validate [id]   校验资产（静默失败是这类插件最大的坑）",
    "  /rp reload          重新读取资产",
    "启动参数：--role <id> / --no-role；快捷键 Ctrl+Alt+R 切换。",
  ].join("\n");
}

/** 读取 RP 总纲覆盖文件（config.systemPromptFile 或 <cwd>/.pi/roleplay/SYSTEM.md）。 */
function readPromptOverride(cwd: string): string | undefined {
  const candidates = [join(cwd, ".pi", "roleplay", "SYSTEM.md"), join(getAgentDir(), "roleplay", "SYSTEM.md")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").trim();
    if (text) return text;
  }
  return undefined;
}

/** 供 /rp status 展示的额外信息（保留导出，便于后续扩展与测试）。 */
export function describeInjection(info: { worldIds: string[]; tokens: number } | undefined): string {
  if (!info) return "尚未注入";
  return `${info.worldIds.length} 条世界书 / ${info.tokens} tokens`;
}

export { RP_TOOLS };
