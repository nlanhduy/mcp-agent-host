/**
 * team-log — Part 2.3: public HTTP MCP server, protected by an API key.
 *
 * Transport is identical to the local HTTP server; the difference is the bearer
 * token guard in front of /mcp. `/health` stays open so uptime checks and PaaS
 * probes work without the key.
 *
 * Deployment: the Dockerfile in this package reads PORT from the environment,
 * which is what Render, Railway, Fly and Cloud Run all inject.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ok, requireBearerToken, safeTool, startHttpMcpServer, ToolError } from "@hw/shared";
import { append, readAll, storePath, type StandupEntry } from "./store.js";

const SERVER_NAME = "team-log";
const SERVER_VERSION = "1.0.0";
const PORT = Number(process.env.PORT ?? 3002);

const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY || API_KEY.length < 16) {
  // Failing loudly at boot is better than deploying an unprotected server that
  // looks like it is working.
  console.error(
    "[team-log] FATAL: set MCP_API_KEY to a random string of at least 16 characters.\n" +
      "  Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\"",
  );
  process.exit(1);
}

/** YYYY-MM-DD in UTC. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // -------------------------------------------------------------------------
  // Tool 1 — log_standup
  // -------------------------------------------------------------------------

  server.registerTool(
    "log_standup",
    {
      title: "Record a standup entry",
      description:
        "Save a daily standup entry to the shared team log. Call this after composing a standup so the team has a record of it.",
      inputSchema: {
        author: z.string().min(1).describe("Who the standup is for."),
        yesterday: z.string().min(1).describe("What was completed since the last standup."),
        today: z.string().min(1).describe("What is planned next."),
        blockers: z.string().default("None").describe("Anything blocking progress."),
        date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
        repo: z.string().optional().describe("Repository the work relates to."),
        commit_count: z.number().int().min(0).optional(),
      },
    },
    safeTool("log_standup", async (args) => {
      const date = args.date ?? today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ToolError(`'${date}' is not a valid date.`, "Use the format YYYY-MM-DD.");
      }

      const entry: StandupEntry = {
        id: randomUUID(),
        author: args.author,
        date,
        yesterday: args.yesterday,
        today: args.today,
        blockers: args.blockers,
        repo: args.repo,
        commit_count: args.commit_count,
        created_at: new Date().toISOString(),
      };

      await append(entry);
      return ok({ saved: true, id: entry.id, date: entry.date, author: entry.author });
    }),
  );

  // -------------------------------------------------------------------------
  // Tool 2 — list_standups
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_standups",
    {
      title: "List standup entries",
      description:
        "Read standup entries back out of the team log, optionally filtered by author or date range.",
      inputSchema: {
        author: z.string().optional().describe("Only entries by this author."),
        from: z.string().optional().describe("Earliest date, inclusive (YYYY-MM-DD)."),
        to: z.string().optional().describe("Latest date, inclusive (YYYY-MM-DD)."),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    safeTool("list_standups", async ({ author, from, to, limit }) => {
      const all = await readAll();

      const matches = all
        .filter((entry) => !author || entry.author.toLowerCase() === author.toLowerCase())
        .filter((entry) => !from || entry.date >= from)
        .filter((entry) => !to || entry.date <= to)
        // Newest first — the common case is "what happened recently".
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);

      return ok({
        total_in_log: all.length,
        count: matches.length,
        filters: { author, from, to },
        entries: matches,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Tool 3 — build_release_notes
  // -------------------------------------------------------------------------

  server.registerTool(
    "build_release_notes",
    {
      title: "Build release notes",
      description:
        "Turn the standup entries in a date range into a markdown release-notes draft grouped by author.",
      inputSchema: {
        from: z.string().describe("Start date, inclusive (YYYY-MM-DD)."),
        to: z.string().optional().describe("End date, inclusive. Defaults to today."),
        title: z.string().default("Release Notes"),
      },
    },
    safeTool("build_release_notes", async ({ from, to, title }) => {
      const end = to ?? today();
      const all = await readAll();
      const inRange = all.filter((entry) => entry.date >= from && entry.date <= end);

      if (inRange.length === 0) {
        return ok({
          from,
          to: end,
          entry_count: 0,
          markdown: `# ${title}\n\n_No standup entries between ${from} and ${end}._`,
          note: "Log some standups first with log_standup, or widen the date range.",
        });
      }

      const byAuthor = new Map<string, StandupEntry[]>();
      for (const entry of inRange) {
        const bucket = byAuthor.get(entry.author) ?? [];
        bucket.push(entry);
        byAuthor.set(entry.author, bucket);
      }

      const sections = [...byAuthor.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([author, entries]) => {
          const bullets = entries
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((entry) => `- **${entry.date}** — ${entry.yesterday}`)
            .join("\n");
          return `## ${author}\n\n${bullets}`;
        });

      const blockers = inRange
        .filter((entry) => entry.blockers && entry.blockers.toLowerCase() !== "none")
        .map((entry) => `- ${entry.author} (${entry.date}): ${entry.blockers}`);

      const markdown = [
        `# ${title}`,
        "",
        `_${from} → ${end} · ${inRange.length} standup entries · ${byAuthor.size} contributors_`,
        "",
        ...sections,
        ...(blockers.length ? ["", "## Open blockers", "", blockers.join("\n")] : []),
      ].join("\n");

      return ok({
        from,
        to: end,
        entry_count: inRange.length,
        contributors: [...byAuthor.keys()],
        markdown,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Resource — server info
  // -------------------------------------------------------------------------

  server.registerResource(
    "settings",
    "teamlog://config/settings",
    {
      title: "team-log settings",
      description: "Deployment and storage information for the public server.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              server: SERVER_NAME,
              version: SERVER_VERSION,
              transport: "streamable-http",
              authentication: "Authorization: Bearer <MCP_API_KEY>",
              storage: storePath(),
              storage_note:
                "JSON file on the container disk. Ephemeral on free PaaS tiers unless DATA_DIR is a mounted volume.",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

startHttpMcpServer({
  createServer,
  port: PORT,
  serverName: SERVER_NAME,
  guard: requireBearerToken(API_KEY),
});
