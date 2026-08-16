/**
 * Helpers for producing MCP `CallToolResult` payloads.
 *
 * The MCP spec draws a hard line between two kinds of failure:
 *
 *  - **Protocol errors** (unknown tool, malformed request) — surfaced as JSON-RPC
 *    errors. The LLM never sees these; the host does.
 *  - **Tool execution errors** (the repo doesn't exist, git exited non-zero) —
 *    returned as a *successful* JSON-RPC response whose result carries
 *    `isError: true`. These are meant to reach the model so it can recover.
 *
 * Almost every failure a tool can hit is the second kind, so `safeTool` below
 * converts thrown exceptions into `isError` results rather than letting them
 * escape as protocol errors.
 */

export type TextContent = { type: "text"; text: string };

export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
  /** Optional machine-readable payload mirroring the text content. */
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A successful tool result. Objects are pretty-printed as JSON. */
export function ok(payload: unknown): ToolResult {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const result: ToolResult = { content: [{ type: "text", text }] };
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    result.structuredContent = payload as Record<string, unknown>;
  }
  return result;
}

/**
 * A failed tool result. `isError: true` is what lets the model read the message
 * and retry with different arguments instead of the whole turn blowing up.
 */
export function fail(message: string, hint?: string): ToolResult {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return { content: [{ type: "text", text }], isError: true };
}

/** Error type whose message is considered safe to show the model verbatim. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Wraps a tool handler so that any thrown error becomes an `isError` result.
 *
 * Wrapping every handler in this means a tool can be written in the natural
 * "throw on bad input" style while still honouring the MCP error contract.
 */
export function safeTool<Args>(
  toolName: string,
  handler: (args: Args) => Promise<ToolResult> | ToolResult,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ToolError) {
        return fail(`${toolName} failed: ${error.message}`, error.hint);
      }
      const message = error instanceof Error ? error.message : String(error);
      return fail(`${toolName} failed: ${message}`);
    }
  };
}
