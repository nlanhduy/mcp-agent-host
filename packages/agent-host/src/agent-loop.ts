/**
 * The agent loop — the call dispatcher at the heart of the host (Part 1).
 *
 *   user message
 *      -> LLM (with the merged tool catalogue attached)
 *      -> if the reply contains tool calls: route each to its MCP server,
 *         feed the results back as `role: "tool"` messages, and ask again
 *      -> otherwise: the reply is the answer
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { LlmEngine, sanitizeToolName, toOpenAiTool } from './llm.js';
import { findSkill, renderSkillIndex, Skill } from './skills.js';

import type { McpManager } from "./mcp-manager.js";
/** The one tool the host implements itself rather than proxying to a server. */
const USE_SKILL_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "use_skill",
    description:
      "Load the full step-by-step instructions for a named skill. Call this first whenever the user's request matches a skill listed in the system prompt.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "The exact name of the skill, as listed under 'Available skills'.",
        },
      },
      required: ["skill_name"],
    },
  },
};

export interface AgentEvents {
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, text: string, isError: boolean) => void;
  onThinking?: (iteration: number) => void;
  onAssistantNote?: (text: string) => void;
  onSkillIncomplete?: (skillName: string, missing: string[]) => void;
}

export interface AgentOptions {
  llm: LlmEngine;
  mcp: McpManager;
  skills: Skill[];
  maxIterations: number;
  defaultRepoPath: string;
  events?: AgentEvents;
}

/**
 * How many times the host may push back on a premature final answer before it
 * gives up and lets the answer through.
 *
 * A cap is required: if a skill lists a tool whose server failed to connect, an
 * uncapped gate would loop until `maxIterations` and return nothing useful.
 */
const MAX_SKILL_NUDGES = 2;

export class Agent {
  private messages: ChatCompletionMessageParam[] = [];
  private tools: ChatCompletionTool[];
  /** Maps the sanitised name the LLM sees back to the catalogue name. */
  private nameMap = new Map<string, string>();
  /** The skill loaded during the current turn, if any. */
  private activeSkill: Skill | null = null;
  /** Qualified names of tools called during the current turn. */
  private calledTools = new Set<string>();

  constructor(private readonly options: AgentOptions) {
    this.tools = [USE_SKILL_TOOL];

    for (const entry of options.mcp.listTools()) {
      const sanitized = sanitizeToolName(entry.qualifiedName);
      this.nameMap.set(sanitized, entry.qualifiedName);
      this.tools.push(toOpenAiTool(entry));
    }

    this.messages.push({ role: "system", content: this.systemPrompt() });
  }

  private systemPrompt(): string {
    const { mcp, skills, defaultRepoPath } = this.options;
    const servers = mcp.serverNames.join(", ") || "(none connected)";

    return [
      "You are an engineering assistant with access to tools from several MCP servers.",
      "",
      `Connected servers: ${servers}.`,
      `Tool names are namespaced as <server>__<tool>. There are ${mcp.listTools().length} tools available.`,
      "",
      "Rules:",
      "- Use tools to obtain facts. Never invent commit hashes, file paths, dates, or counts.",
      `- When a tool needs a repository path and the user did not name one, use: ${defaultRepoPath}`,
      "- If a tool result says it is an error, read the message, fix the arguments, and try once more.",
      "  If it fails again, tell the user plainly what failed. Do not pretend it succeeded.",
      "- To use a tool, issue a real tool call. Never write the call out as text or JSON in your",
      "  reply — a printed call is not executed, and the user sees raw JSON instead of an answer.",
      "- When you have the information you need, answer directly. Do not call more tools.",
      "",
      renderSkillIndex(skills),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Clears the conversation but keeps the system prompt and tool catalogue. */
  reset(): void {
    this.messages = [{ role: "system", content: this.systemPrompt() }];
    this.activeSkill = null;
    this.calledTools.clear();
  }

  get toolCount(): number {
    return this.tools.length;
  }

  async send(userMessage: string): Promise<string> {
    const { llm, maxIterations, events } = this.options;
    this.messages.push({ role: "user", content: userMessage });

    // Skill state is per-turn: a skill loaded for the previous request says
    // nothing about what this one must do.
    this.activeSkill = null;
    this.calledTools.clear();
    let nudges = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      events?.onThinking?.(iteration);

      const reply = await llm.chat(this.messages, this.tools);
      if (!reply) return "The model returned an empty response.";

      const toolCalls = this.extractToolCalls(reply);

      if (toolCalls.length === 0) {
        const missing = this.missingSkillTools();

        if (missing.length > 0 && nudges < MAX_SKILL_NUDGES) {
          nudges += 1;
          events?.onSkillIncomplete?.(this.activeSkill!.name, missing);
          this.messages.push({ role: "assistant", content: reply.content ?? "" });
          this.messages.push({
            role: "user",
            content:
              `You have not finished the '${this.activeSkill!.name}' skill. These required steps ` +
              `have not been performed yet: ${missing.join(", ")}. ` +
              `Call them now using the results you already have. Do not write your final answer ` +
              `until they have all returned.`,
          });
          continue;
        }

        const content = stripReasoning(reply.content ?? "");
        this.messages.push({ role: "assistant", content: reply.content ?? "" });
        return content || "(the model produced no text)";
      }

      // When the call had to be recovered from text, that text *is* the call —
      // showing it would look like noise, and echoing it back into the history
      // teaches the model that printing tool calls as prose is acceptable.
      const recovered = !reply.tool_calls?.length;
      const note = recovered ? "" : stripReasoning(reply.content ?? "").trim();

      // Any prose alongside the tool calls is usually the model narrating its
      // plan — worth showing, but it isn't the final answer.
      if (note) events?.onAssistantNote?.(note);

      this.messages.push({
        role: "assistant",
        content: recovered ? "" : (reply.content ?? ""),
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const outcome = await this.dispatch(call);
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: outcome,
        });
      }
    }

    return (
      `Stopped after ${maxIterations} tool-calling rounds without reaching an answer. ` +
      `The model may be looping; try rephrasing the request or raising llm.maxIterations.`
    );
  }

  /**
   * Required tools of the active skill that have not been called this turn.
   *
   * A tool the host cannot reach is dropped from the check: holding the model
   * to a step that is impossible would block the answer forever, and the skill
   * body already tells it to report which step failed.
   */
  private missingSkillTools(): string[] {
    if (!this.activeSkill) return [];
    return this.activeSkill.requiredTools.filter(
      (tool) => !this.calledTools.has(tool) && this.options.mcp.has(tool),
    );
  }

  /** Routes one tool call to `use_skill` or to the owning MCP server. */
  private async dispatch(call: ChatCompletionMessageToolCall): Promise<string> {
    const { mcp, skills, events } = this.options;
    const rawName = call.function.name;

    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      const message = `Arguments for ${rawName} were not valid JSON. Re-issue the call with a valid JSON object.`;
      events?.onToolResult?.(rawName, message, true);
      return `ERROR: ${message}`;
    }

    events?.onToolCall?.(rawName, args);

    if (rawName === "use_skill") {
      const skillName = String(args.skill_name ?? args.skill ?? "");
      const skill = findSkill(skills, skillName);
      if (!skill) {
        const message =
          `No skill named '${skillName}'. Available skills: ${skills.map((s) => s.name).join(", ") || "(none)"}`;
        events?.onToolResult?.(rawName, message, true);
        return `ERROR: ${message}`;
      }
      this.activeSkill = skill;
      events?.onToolResult?.(rawName, `Loaded skill '${skill.name}' (${skill.body.length} chars)`, false);
      return `Instructions for the '${skill.name}' skill. Follow them step by step:\n\n${skill.body}`;
    }

    const qualifiedName = this.nameMap.get(rawName) ?? rawName;
    const outcome = await mcp.callTool(qualifiedName, args);

    // Recorded through the catalogue so a bare tool name still counts: the
    // model often drops the namespace, and `resolve` is what reconciles that.
    if (!outcome.isError) {
      this.calledTools.add(mcp.resolve(qualifiedName)?.qualifiedName ?? qualifiedName);
    }

    events?.onToolResult?.(rawName, outcome.text, outcome.isError);

    // The `isError` flag has no representation in OpenAI's tool-message format,
    // so it is surfaced in the text. Small models reliably notice a leading
    // "ERROR:" and adjust; they often skip past a failure buried in JSON.
    return outcome.isError ? `ERROR: ${outcome.text}` : outcome.text;
  }

  /**
   * Reads tool calls from the model's reply.
   *
   * Small models emit tool calls three different ways, and qwen3:4b uses all
   * three from one session to the next:
   *
   *   1. the structured `tool_calls` field — the OpenAI contract;
   *   2. text wrapped in `<tool_call>{...}</tool_call>` — Qwen's native format
   *      leaking through Ollama's compatibility layer;
   *   3. a bare JSON object in `content`, with no wrapper at all.
   *
   * Only (1) is handled by the SDK. Recovering (2) and (3) is what keeps the
   * agent usable on a 4B model.
   */
  private extractToolCalls(reply: {
    content?: string | null;
    tool_calls?: ChatCompletionMessageToolCall[];
  }): ChatCompletionMessageToolCall[] {
    if (reply.tool_calls?.length) return reply.tool_calls;

    const content = stripThinking(reply.content ?? "");
    const tagged =[...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)].map((m) => m[1]);
    const candidates = tagged.length > 0 ? tagged : this.bareJsonCandidates(content);

    const recovered: ChatCompletionMessageToolCall[] = [];
    candidates.forEach((candidate, index) => {
      try {
        const parsed = JSON.parse(candidate) as {
          name?: string;
          arguments?: unknown;
          parameters?: unknown;
        };
        if (!parsed.name) return;
        recovered.push({
          id: `recovered_${index}_${parsed.name}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: JSON.stringify(parsed.arguments ?? parsed.parameters ?? {}),
          },
        });
      } catch {
        // Not parseable — treat it as prose and let the model try again.
      }
    });

    return recovered;
  }

  /**
   * Treats a reply that is *nothing but* a JSON object as an unwrapped tool
   * call — but only when its `name` matches a tool that actually exists.
   *
   * That guard matters: without it, a legitimate answer that happens to be JSON
   * would be dispatched as a tool call instead of shown to the user.
   */
  private bareJsonCandidates(content: string): string[] {
    const text = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    if (!text.startsWith("{") && !text.startsWith("[")) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }

    const objects = Array.isArray(parsed) ? parsed : [parsed];
    const known = new Set(this.tools.map((t) => t.function.name));

    return objects.every(
      (o) => typeof (o as { name?: unknown })?.name === "string" && known.has((o as { name: string }).name),
    )
      ? objects.map((o) => JSON.stringify(o))
      : [];
  }
}

/**
 * Removes chain-of-thought and tool-call markup from text meant for the user.
 *
 * Qwen3 wraps its reasoning in `<think>...</think>`. Two ragged cases show up
 * in practice and both need handling: an unclosed `<think>` when generation was
 * cut short, and — more commonly — a bare closing `</think>` with no opener,
 * which is what Ollama emits once `reasoning_effort: "none"` stops it from
 * splitting reasoning into its own field. In that second case everything before
 * the tag is reasoning, so the answer is what follows it.
 */
function stripReasoning(content: string): string {
  return stripThinking(content).replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

/**
 * Removes chain-of-thought only, leaving any tool-call markup intact.
 *
 * `extractToolCalls` needs this variant: it must see past the reasoning to find
 * a call, but stripping `<tool_call>` blocks would delete the very thing it is
 * looking for.
 */
function stripThinking(content: string): string {
  let text = content.replace(/<think>[\s\S]*?<\/think>/g, "");

  const orphanClose = text.lastIndexOf("</think>");
  if (orphanClose !== -1) text = text.slice(orphanClose + "</think>".length);

  const orphanOpen = text.indexOf("<think>");
  if (orphanOpen !== -1) text = text.slice(0, orphanOpen);

  return text.trim();
}
