/**
 * The MCP client layer of the host.
 *
 * Responsibilities (Part 1):
 *   - open a connection per configured server, over the right transport
 *   - aggregate every server's tools into one namespaced catalogue
 *   - dispatch a tool call back to the server that owns it
 *
 * Namespacing matters: two servers may each expose a `search` tool, and the LLM
 * sees one flat list. Every tool is therefore advertised as
 * `<server>__<tool>`, and the dispatch table maps that name back to its owner.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { isHttpServer, resolveFromConfig, type HostConfig, type ServerConfig } from "./config.js";

/** Separator between server name and tool name. Double underscore is safe in
 *  OpenAI function names, which allow only [A-Za-z0-9_-]. */
const NS = "__";

export interface CatalogEntry {
  /** Name shown to the LLM, e.g. "git-inspector__git_recent_commits". */
  qualifiedName: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Tool["inputSchema"];
}

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

interface Connection {
  name: string;
  client: Client;
  close: () => Promise<void>;
}

export class McpManager {
  private connections = new Map<string, Connection>();
  private catalog = new Map<string, CatalogEntry>();
  readonly failures: Array<{ server: string; reason: string }> = [];

  constructor(private readonly config: HostConfig) {}

  /**
   * Connects to every enabled server in parallel and builds the tool catalogue.
   * A server that fails to start is recorded and skipped rather than aborting
   * the host — a working demo with two of three servers beats no demo at all.
   */
  async connectAll(): Promise<void> {
    const entries = Object.entries(this.config.mcpServers).filter(
      ([, server]) => !server.disabled,
    );

    await Promise.all(
      entries.map(async ([name, server]) => {
        try {
          const connection = await this.connect(name, server);
          this.connections.set(name, connection);
          await this.indexTools(connection);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.failures.push({ server: name, reason });
        }
      }),
    );
  }

  private async connect(name: string, server: ServerConfig): Promise<Connection> {
    const client = new Client(
      { name: "hw-agent-host", version: "1.0.0" },
      { capabilities: {} },
    );

    if (isHttpServer(server)) {
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      });
      await client.connect(transport);
      return { name, client, close: () => transport.close() };
    }

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd ? resolveFromConfig(this.config, server.cwd) : undefined,
      // Child servers inherit the host's environment plus their own overrides,
      // so things like DEFAULT_REPO_PATH reach them without duplication.
      env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
      stderr: "pipe",
    });
    await client.connect(transport);
    return { name, client, close: () => transport.close() };
  }

  private async indexTools(connection: Connection): Promise<void> {
    const { tools } = await connection.client.listTools();
    for (const tool of tools) {
      const qualifiedName = `${connection.name}${NS}${tool.name}`;
      this.catalog.set(qualifiedName, {
        qualifiedName,
        serverName: connection.name,
        toolName: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: tool.inputSchema,
      });
    }
  }

  listTools(): CatalogEntry[] {
    return [...this.catalog.values()];
  }

  get serverNames(): string[] {
    return [...this.connections.keys()];
  }

  has(qualifiedName: string): boolean {
    return this.catalog.has(qualifiedName);
  }

  /**
   * Resolves a name the model produced to a catalogue entry.
   *
   * Small models frequently drop the namespace and just say `find_todos`, so an
   * unambiguous bare tool name is accepted too. Without this the host would
   * reject calls that were substantively correct.
   */
  resolve(name: string): CatalogEntry | undefined {
    const exact = this.catalog.get(name);
    if (exact) return exact;

    const bareMatches = this.listTools().filter((entry) => entry.toolName === name);
    return bareMatches.length === 1 ? bareMatches[0] : undefined;
  }

  /** Executes a tool on its owning server and flattens the result to text. */
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallOutcome> {
    const entry = this.resolve(qualifiedName);
    if (!entry) {
      return {
        text:
          `Unknown tool '${qualifiedName}'. Available tools: ` +
          this.listTools().map((t) => t.qualifiedName).join(", "),
        isError: true,
      };
    }

    const connection = this.connections.get(entry.serverName);
    if (!connection) {
      return { text: `Server '${entry.serverName}' is not connected.`, isError: true };
    }

    try {
      const result = await connection.client.callTool({
        name: entry.toolName,
        arguments: args,
      });

      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "resource") return JSON.stringify(block.resource);
          return `[${block.type} content]`;
        })
        .join("\n")
        .trim();

      return { text: text || "(tool returned no content)", isError: result.isError === true };
    } catch (error) {
      // A protocol-level failure — transport dropped, tool rejected the shape
      // of the arguments. Report it as a tool error so the loop can continue.
      const reason = error instanceof Error ? error.message : String(error);
      return { text: `Calling ${entry.qualifiedName} failed: ${reason}`, isError: true };
    }
  }

  /** Aggregated resources across all servers (Part 2 requires at least one). */
  async listResources(): Promise<Array<{ server: string; uri: string; name: string }>> {
    const found: Array<{ server: string; uri: string; name: string }> = [];
    for (const connection of this.connections.values()) {
      try {
        const { resources } = await connection.client.listResources();
        for (const resource of resources) {
          found.push({ server: connection.name, uri: resource.uri, name: resource.name });
        }
      } catch {
        // Servers that declare no resource capability throw here. Not an error.
      }
    }
    return found;
  }

  async readResource(uri: string): Promise<string> {
    for (const connection of this.connections.values()) {
      try {
        const result = await connection.client.readResource({ uri });
        return result.contents
          .map((content) => ("text" in content ? content.text : `[binary ${content.uri}]`))
          .join("\n");
      } catch {
        continue; // wrong server for this URI — try the next
      }
    }
    throw new Error(`No connected server could serve the resource '${uri}'.`);
  }

  /** Aggregated prompt templates across all servers. */
  async listPrompts(): Promise<Array<{ server: string; name: string; description: string }>> {
    const found: Array<{ server: string; name: string; description: string }> = [];
    for (const connection of this.connections.values()) {
      try {
        const { prompts } = await connection.client.listPrompts();
        for (const prompt of prompts) {
          found.push({
            server: connection.name,
            name: prompt.name,
            description: prompt.description ?? "",
          });
        }
      } catch {
        // No prompts capability on this server.
      }
    }
    return found;
  }

  async getPrompt(name: string, args: Record<string, string>): Promise<string> {
    for (const connection of this.connections.values()) {
      try {
        const result = await connection.client.getPrompt({ name, arguments: args });
        return result.messages
          .map((message) =>
            message.content.type === "text" ? message.content.text : "[non-text content]",
          )
          .join("\n");
      } catch {
        continue;
      }
    }
    throw new Error(`No connected server exposes a prompt named '${name}'.`);
  }

  /**
   * Closes every connection. A transport that refuses to settle — a stdio child
   * ignoring its pipe closing, an HTTP session mid-stream — must not hang the
   * host on the way out, so the whole shutdown is bounded.
   */
  async closeAll(timeoutMs = 2000): Promise<void> {
    const closings = [...this.connections.values()].map((connection) =>
      connection.close().catch(() => undefined),
    );
    await Promise.race([
      Promise.all(closings),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    this.connections.clear();
    this.catalog.clear();
  }
}
