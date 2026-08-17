#!/usr/bin/env node
/**
 * Interactive REPL for the agent host.
 *
 *   node packages/agent-host/dist/index.js [path/to/mcp_config.json]
 *
 * Tool calls and their results are printed as they happen — that visibility is
 * the point of the CLI, both for debugging and for the demo recording.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { Agent } from "./agent-loop.js";
import { loadConfig, resolveFromConfig } from "./config.js";
import { LlmEngine } from "./llm.js";
import { McpManager } from "./mcp-manager.js";
import { loadSkills } from "./skills.js";

const c = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
};

/** Keeps printed tool output readable in a terminal. */
function truncate(text: string, limit = 600): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}… (${flat.length} chars total)` : flat;
}

const HELP = `
${c.bold}Commands${c.reset}
  ${c.cyan}/tools${c.reset}      list every tool merged from the connected servers
  ${c.cyan}/resources${c.reset}  list MCP resources, or read one: /resources <uri>
  ${c.cyan}/prompts${c.reset}    list MCP prompt templates
  ${c.cyan}/skills${c.reset}     list loaded skills
  ${c.cyan}/reset${c.reset}      clear the conversation history
  ${c.cyan}/help${c.reset}       show this message
  ${c.cyan}/exit${c.reset}       quit

Anything else is sent to the model.
`;

async function main() {
  const configPath = resolve(
    process.argv[2] ?? process.env.MCP_CONFIG_PATH ?? "./mcp_config.json",
  );

  console.log(`${c.bold}MCP Agent Host${c.reset} ${c.dim}(22127086)${c.reset}`);
  console.log(`${c.dim}config: ${configPath}${c.reset}\n`);

  const config = await loadConfig(configPath);

  // 1. LLM engine — check it before spending time on server startup.
  const llm = new LlmEngine({
    baseUrl: process.env.OLLAMA_BASE_URL ?? config.llm.baseUrl,
    model: process.env.OLLAMA_MODEL ?? config.llm.model,
    apiKey: config.llm.apiKey,
    temperature: config.llm.temperature,
    extraBody: config.llm.extraBody,
  });

  const preflight = await llm.preflight();
  console.log(
    preflight.ok
      ? `${c.green}✓${c.reset} ${preflight.message}`
      : `${c.red}✗${c.reset} ${preflight.message}`,
  );
  if (!preflight.ok) process.exit(1);

  // 2. Connect to every configured MCP server and merge their tools.
  const mcp = new McpManager(config);
  await mcp.connectAll();

  for (const server of mcp.serverNames) {
    const count = mcp.listTools().filter((tool) => tool.serverName === server).length;
    console.log(`${c.green}✓${c.reset} ${server} ${c.dim}(${count} tools)${c.reset}`);
  }
  for (const failure of mcp.failures) {
    console.log(`${c.red}✗${c.reset} ${failure.server} ${c.dim}${failure.reason}${c.reset}`);
  }

  // 3. Load skills for the system-prompt index.
  const skillsDir = resolveFromConfig(config, config.skillsPath);
  const skills = await loadSkills(skillsDir);
  console.log(
    `${c.green}✓${c.reset} ${skills.length} skill(s) ${c.dim}from ${skillsDir}${c.reset}`,
  );

  const agent = new Agent({
    llm,
    mcp,
    skills,
    maxIterations: config.llm.maxIterations,
    defaultRepoPath: process.env.DEFAULT_REPO_PATH ?? config.configDir,
    events: {
      onThinking: (iteration) => {
        if (iteration > 1) process.stdout.write(`${c.dim}  …round ${iteration}${c.reset}\n`);
      },
      onAssistantNote: (text) => console.log(`${c.dim}  ${truncate(text, 200)}${c.reset}`),
      onToolCall: (name, args) =>
        console.log(`${c.magenta}  → ${name}${c.reset} ${c.dim}${truncate(JSON.stringify(args), 200)}${c.reset}`),
      onSkillIncomplete: (skillName, missing) =>
        console.log(
          `${c.yellow}  ⟲ skill '${skillName}' incomplete — still required: ${missing.join(", ")}${c.reset}`,
        ),
      onToolResult: (name, text, isError) =>
        console.log(
          isError
            ? `${c.red}  ← ${name} isError=true${c.reset} ${c.dim}${truncate(text, 300)}${c.reset}`
            : `${c.green}  ← ${name}${c.reset} ${c.dim}${truncate(text, 300)}${c.reset}`,
        ),
    },
  });

  console.log(
    `\n${c.dim}${agent.toolCount} tools in context (including use_skill). Type /help for commands.${c.reset}\n`,
  );

  const rl = createInterface({ input: stdin, output: stdout });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Backstop: if a transport refuses to settle, leave anyway. Without this a
    // stdio child server can outlive the host and hold onto its pipes.
    const hardExit = setTimeout(() => process.exit(0), 4000);
    hardExit.unref();

    rl.close();
    await mcp.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  // `rl.question()` never settles once stdin hits EOF, so Ctrl-D and piped
  // input have to be caught here rather than by the loop below.
  rl.on("close", () => void shutdown());

  while (true) {
    let line: string;
    try {
      line = (await rl.question(`${c.bold}${c.cyan}you ›${c.reset} `)).trim();
    } catch {
      break; // readline rejected the pending question
    }
    if (!line) continue;

    if (line.startsWith("/")) {
      const [command, ...rest] = line.split(/\s+/);
      const argument = rest.join(" ");

      switch (command) {
        case "/exit":
        case "/quit":
          await shutdown();
          break;

        case "/help":
          console.log(HELP);
          break;

        case "/tools": {
          const tools = mcp.listTools();
          for (const server of mcp.serverNames) {
            console.log(`\n${c.bold}${server}${c.reset}`);
            for (const tool of tools.filter((t) => t.serverName === server)) {
              console.log(`  ${c.cyan}${tool.qualifiedName}${c.reset}`);
              console.log(`    ${c.dim}${truncate(tool.description, 140)}${c.reset}`);
            }
          }
          console.log(`\n${c.bold}host${c.reset}\n  ${c.cyan}use_skill${c.reset}\n`);
          break;
        }

        case "/resources": {
          if (argument) {
            try {
              console.log(await mcp.readResource(argument));
            } catch (error) {
              console.log(`${c.red}${error instanceof Error ? error.message : error}${c.reset}`);
            }
          } else {
            const resources = await mcp.listResources();
            if (resources.length === 0) console.log(`${c.dim}No resources exposed.${c.reset}`);
            for (const resource of resources) {
              console.log(`  ${c.cyan}${resource.uri}${c.reset} ${c.dim}[${resource.server}] ${resource.name}${c.reset}`);
            }
            console.log(`${c.dim}Read one with: /resources <uri>${c.reset}`);
          }
          break;
        }

        case "/prompts": {
          const prompts = await mcp.listPrompts();
          if (prompts.length === 0) console.log(`${c.dim}No prompt templates exposed.${c.reset}`);
          for (const prompt of prompts) {
            console.log(`  ${c.cyan}${prompt.name}${c.reset} ${c.dim}[${prompt.server}] ${prompt.description}${c.reset}`);
          }
          break;
        }

        case "/skills": {
          if (skills.length === 0) console.log(`${c.dim}No skills loaded.${c.reset}`);
          for (const skill of skills) {
            console.log(`  ${c.cyan}${skill.name}${c.reset}`);
            console.log(`    ${c.dim}${skill.description}${c.reset}`);
          }
          break;
        }

        case "/reset":
          agent.reset();
          console.log(`${c.dim}Conversation cleared.${c.reset}`);
          break;

        default:
          console.log(`${c.yellow}Unknown command '${command}'. Try /help.${c.reset}`);
      }
      continue;
    }

    try {
      const answer = await agent.send(line);
      console.log(`\n${c.bold}${c.green}agent ›${c.reset} ${answer}\n`);
    } catch (error) {
      console.log(
        `\n${c.red}Request failed: ${error instanceof Error ? error.message : error}${c.reset}\n`,
      );
    }
  }

  await shutdown();
}

main().catch((error) => {
  console.error(`${c.red}${error instanceof Error ? error.message : error}${c.reset}`);
  process.exit(1);
});
