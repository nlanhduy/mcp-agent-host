/**
 * LLM engine: a local Ollama model reached through its OpenAI-compatible API.
 *
 * Ollama serves `/v1/chat/completions` at :11434, so the standard `openai`
 * client works unchanged — the API key is required by the client library but
 * ignored by Ollama.
 */

import OpenAI from "openai";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CatalogEntry } from "./mcp-manager.js";

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  /**
   * Extra fields merged into the request body.
   *
   * Ollama accepts vendor options here that the OpenAI schema has no room for.
   * The one that matters in practice is `{"reasoning_effort": "none"}`, which
   * turns off qwen3's chain-of-thought — roughly a 5x speedup per round on a
   * laptop. (Note that Ollama's `think: false` is *not* honoured on the /v1
   * endpoint, only on its native /api/chat.)
   */
  extraBody?: Record<string, unknown>;
}

export class LlmEngine {
  private client: OpenAI;

  constructor(private readonly settings: LlmSettings) {
    this.client = new OpenAI({
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey,
      // Local inference on a 4B model is slow; the SDK's 10 min default is fine
      // but a single retry avoids failing a demo on one dropped socket.
      maxRetries: 1,
    });
  }

  get model(): string {
    return this.settings.model;
  }

  /** Verifies Ollama is up and the configured model is actually pulled. */
  async preflight(): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.client.models.list();
      const available = models.data.map((model) => model.id);
      if (!available.some((id) => id === this.settings.model || id.startsWith(`${this.settings.model}`))) {
        return {
          ok: false,
          message:
            `Model '${this.settings.model}' is not available on ${this.settings.baseUrl}.\n` +
            `  Pulled models: ${available.join(", ") || "(none)"}\n` +
            `  Fix with: ollama pull ${this.settings.model}`,
        };
      }
      return { ok: true, message: `Connected to ${this.settings.baseUrl} using ${this.settings.model}` };
    } catch (error) {
      return {
        ok: false,
        message:
          `Could not reach the LLM at ${this.settings.baseUrl}: ` +
          `${error instanceof Error ? error.message : error}\n` +
          `  Is Ollama running? Start it with: ollama serve`,
      };
    }
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ) {
    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages,
      temperature: this.settings.temperature,
      ...(tools.length ? { tools, tool_choice: "auto" as const } : {}),
      ...this.settings.extraBody,
    });
    return response.choices[0]?.message;
  }
}

/**
 * Converts an MCP tool definition to an OpenAI function definition.
 *
 * MCP `inputSchema` is already JSON Schema, so this is mostly a re-wrap. The
 * one substantive step is the name: OpenAI restricts function names to
 * `[A-Za-z0-9_-]{1,64}`, and MCP server names may contain other characters.
 */
export function toOpenAiTool(entry: CatalogEntry): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: sanitizeToolName(entry.qualifiedName),
      description: `[${entry.serverName}] ${entry.description}`,
      parameters: entry.inputSchema as Record<string, unknown>,
    },
  };
}

export function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}
