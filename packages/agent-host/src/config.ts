/**
 * Configuration loader for the agent host.
 *
 * The schema intentionally mirrors Claude Desktop's `claude_desktop_config.json`
 * so a single file shape describes the same servers to both hosts — that's the
 * dual-host interoperability requirement (Part 4) reduced to one decision.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { z } from "zod";

const StdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  /** Working directory for the child process. Relative to the config file. */
  cwd: z.string().optional(),
  disabled: z.boolean().default(false),
});

const HttpServerSchema = z.object({
  type: z.enum(["http", "streamable-http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  disabled: z.boolean().default(false),
});

const ServerSchema = z.union([HttpServerSchema, StdioServerSchema]);

const ConfigSchema = z.object({
  /** LLM engine settings. Every field has a working default. */
  llm: z
    .object({
      baseUrl: z.string().url().default("http://localhost:11434/v1"),
      model: z.string().default("qwen3:4b"),
      apiKey: z.string().default("ollama"),
      temperature: z.number().min(0).max(2).default(0.3),
      maxIterations: z.number().int().min(1).max(25).default(10),
      /** Vendor-specific fields merged into the chat-completions request body. */
      extraBody: z.record(z.unknown()).optional(),
    })
    .default({}),
  /** Directory containing `<skill>/SKILL.md` folders. Relative to the config file. */
  skillsPath: z.string().default("./skills"),
  mcpServers: z.record(ServerSchema).default({}),
});

export type StdioServerConfig = z.infer<typeof StdioServerSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerSchema>;
export type ServerConfig = z.infer<typeof ServerSchema>;
export type HostConfig = z.infer<typeof ConfigSchema> & { configDir: string };

export function isHttpServer(config: ServerConfig): config is HttpServerConfig {
  return "url" in config;
}

/**
 * Substitutes `${VAR}` references with process environment values.
 *
 * This is what keeps the committed config free of secrets: the public server's
 * entry says `"Bearer ${MCP_API_KEY}"` and the real key stays in the shell.
 */
function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        console.warn(
          `[config] ${match} is referenced in the config but not set in the environment; leaving it as-is.`,
        );
        return match;
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, expandEnv(v)]),
    );
  }
  return value;
}

export async function loadConfig(configPath: string): Promise<HostConfig> {
  const absPath = resolve(configPath);

  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    throw new Error(
      `Could not read config file at ${absPath}.\n` +
        `Pass a path as the first argument, or set MCP_CONFIG_PATH.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${absPath} is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }

  const parsed = ConfigSchema.safeParse(expandEnv(json));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`${absPath} does not match the expected schema:\n${issues}`);
  }

  return { ...parsed.data, configDir: dirname(absPath) };
}

/** Resolves a config-relative path against the config file's directory. */
export function resolveFromConfig(config: HostConfig, path: string): string {
  return isAbsolute(path) ? path : resolve(config.configDir, path);
}
