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
import { LlmEngine, sanitizeToolName, toOpenAiTool } from "./llm.js";
import type { McpManager } from "./mcp-manager.js";
import { findSkill, renderSkillIndex, type Skill } from "./skills.js";

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
}

export interface AgentOptions {
  llm: LlmEngine;
  mcp: McpManager;
  skills: Skill[];
  maxIterations: number;
  defaultRepoPath: string;
  events?: AgentEvents;
}

export class Agent {
  private messages: ChatCompletionMessageParam[] = [];
  private tools: ChatCompletionTool[];
  /** Maps the sanitised name the LLM sees back to the catalogue name. */
  private nameMap = new Map<string, string>();

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
  }

  get toolCount(): number {
    return this.tools.length;
  }

  async send(userMessage: string): Promise<string> {
    const { llm, maxIterations, events } = this.options;
    this.messages.push({ role: "user", content: userMessage });

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      events?.onThinking?.(iteration);

      const reply = await llm.chat(this.messages, this.tools);
      if (!reply) return "The model returned an empty response.";

      const toolCalls = this.extractToolCalls(reply);

      if (toolCalls.length === 0) {
        const content = stripReasoning(reply.content ?? "");
        this.messages.push({ role: "assistant", content: reply.content ?? "" });
        return content || "(the model produced no text)";
      }

      // Any prose alongside the tool calls is usually the model narrating its
      // plan — worth showing, but it isn't the final answer.
      const note = stripReasoning(reply.content ?? "").trim();
      if (note) events?.onAssistantNote?.(note);

      this.messages.push({
        role: "assistant",
        content: reply.content ?? "",
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
      const skillName = String(args.skill_name ?? "");
      const skill = findSkill(skills, skillName);
      if (!skill) {
        const message =
          `No skill named '${skillName}'. Available skills: ${skills.map((s) => s.name).join(", ") || "(none)"}`;
        events?.onToolResult?.(rawName, message, true);
        return `ERROR: ${message}`;
      }
      events?.onToolResult?.(rawName, `Loaded skill '${skill.name}' (${skill.body.length} chars)`, false);
      return `Instructions for the '${skill.name}' skill. Follow them step by step:\n\n${skill.body}`;
    }

    const qualifiedName = this.nameMap.get(rawName) ?? rawName;
    const outcome = await mcp.callTool(qualifiedName, args);
    events?.onToolResult?.(rawName, outcome.text, outcome.isError);

    // The `isError` flag has no representation in OpenAI's tool-message format,
    // so it is surfaced in the text. Small models reliably notice a leading
    // "ERROR:" and adjust; they often skip past a failure buried in JSON.
    return outcome.isError ? `ERROR: ${outcome.text}` : outcome.text;
  }

  /**
   * Reads tool calls from the model's reply.
   *
   * Qwen and other small models sometimes emit a tool call as text inside
   * `<tool_call>{"name":..., "arguments":{...}}</tool_call>` instead of filling
   * in the structured `tool_calls` field. Recovering those keeps the agent
   * working with models whose OpenAI-compatibility layer is imperfect.
   */
  private extractToolCalls(reply: {
    content?: string | null;
    tool_calls?: ChatCompletionMessageToolCall[];
  }): ChatCompletionMessageToolCall[] {
    if (reply.tool_calls?.length) return reply.tool_calls;

    const content = reply.content ?? "";
    const matches = [...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
    if (matches.length === 0) return [];

    const recovered: ChatCompletionMessageToolCall[] = [];
    matches.forEach((match, index) => {
      try {
        const parsed = JSON.parse(match[1]) as { name?: string; arguments?: unknown };
        if (!parsed.name) return;
        recovered.push({
          id: `recovered_${index}_${parsed.name}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: JSON.stringify(parsed.arguments ?? {}),
          },
        });
      } catch {
        // Not parseable — treat it as prose and let the model try again.
      }
    });

    return recovered;
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
  let text = content.replace(/<think>[\s\S]*?<\/think>/g, "");

  const orphanClose = text.lastIndexOf("</think>");
  if (orphanClose !== -1) text = text.slice(orphanClose + "</think>".length);

  const orphanOpen = text.indexOf("<think>");
  if (orphanOpen !== -1) text = text.slice(0, orphanOpen);

  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}
