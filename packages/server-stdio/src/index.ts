#!/usr/bin/env node
/**
 * git-inspector — Part 2.1: stdio MCP server.
 *
 * Exposes three git tools, one resource, and one prompt template over the
 * stdio transport, with tool failures reported via the MCP `isError` flag.
 *
 * IMPORTANT: on stdio, stdout *is* the protocol channel. Every diagnostic in
 * this file therefore goes to stderr — a stray console.log would corrupt the
 * JSON-RPC stream and break the connection.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { assertGitRepo, git, gitRaw, readCommits, ok, safeTool, ToolError } from "@hw/shared";

const SERVER_NAME = "git-inspector";
const SERVER_VERSION = "1.0.0";

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

// ---------------------------------------------------------------------------
// Tool 1 — git_recent_commits
// ---------------------------------------------------------------------------

server.registerTool(
  "git_recent_commits",
  {
    title: "Recent git commits",
    description:
      "List recent commits in a local git repository. Use this to find out what work was done, by whom, and when.",
    inputSchema: {
      repo_path: z.string().describe("Absolute path to the git repository."),
      since: z
        .string()
        .optional()
        .describe("Only commits after this date. Accepts git date syntax, e.g. '1 day ago', '2026-08-01'."),
      author: z.string().optional().describe("Filter by author name or email substring."),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum commits to return."),
    },
  },
  safeTool("git_recent_commits", async ({ repo_path, since, author, limit }) => {
    const repo = await assertGitRepo(repo_path);
    const commits = await readCommits(repo, { since, author, limit });

    if (commits.length === 0) {
      // Not an error: an empty range is a legitimate answer, and saying so
      // plainly stops the model from retrying the same call in a loop.
      return ok({
        repo,
        filters: { since, author, limit },
        count: 0,
        commits: [],
        note: "No commits matched. Try widening `since` or dropping `author`.",
      });
    }

    return ok({
      repo,
      filters: { since, author, limit },
      count: commits.length,
      range: `${commits[commits.length - 1].shortHash}..${commits[0].shortHash}`,
      commits,
    });
  }),
);

// ---------------------------------------------------------------------------
// Tool 2 — git_diff_stats
// ---------------------------------------------------------------------------

const DIFF_STAT_LINE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

server.registerTool(
  "git_diff_stats",
  {
    title: "Git diff statistics",
    description:
      "Summarise how much changed between two git revisions: files touched, lines added and removed.",
    inputSchema: {
      repo_path: z.string().describe("Absolute path to the git repository."),
      rev_range: z
        .string()
        .default("HEAD~1..HEAD")
        .describe("Revision range, e.g. 'HEAD~5..HEAD', 'main..feature', or a single commit hash."),
    },
  },
  safeTool("git_diff_stats", async ({ repo_path, rev_range }) => {
    const repo = await assertGitRepo(repo_path);

    // `--numstat` gives machine-readable per-file counts; binary files show '-'.
    const stdout = await git(repo, ["diff", "--numstat", rev_range, "--"]);

    const files = stdout
      .split("\n")
      .map((line) => line.match(DIFF_STAT_LINE))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({
        file: match[3],
        insertions: match[1] === "-" ? null : Number(match[1]),
        deletions: match[2] === "-" ? null : Number(match[2]),
        binary: match[1] === "-",
      }));

    const totals = files.reduce(
      (acc, file) => ({
        insertions: acc.insertions + (file.insertions ?? 0),
        deletions: acc.deletions + (file.deletions ?? 0),
      }),
      { insertions: 0, deletions: 0 },
    );

    return ok({
      repo,
      rev_range,
      files_changed: files.length,
      ...totals,
      net: totals.insertions - totals.deletions,
      files,
    });
  }),
);

// ---------------------------------------------------------------------------
// Tool 3 — git_search_files
// ---------------------------------------------------------------------------

server.registerTool(
  "git_search_files",
  {
    title: "Search tracked files",
    description:
      "Search the text of all git-tracked files for a pattern. Returns matching file paths, line numbers, and the matching line.",
    inputSchema: {
      repo_path: z.string().describe("Absolute path to the git repository."),
      pattern: z.string().min(1).describe("Text or regular expression to search for."),
      glob: z
        .string()
        .optional()
        .describe("Restrict to matching paths, e.g. '*.ts' or 'src/**'."),
      case_sensitive: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
    },
  },
  safeTool("git_search_files", async ({ repo_path, pattern, glob, case_sensitive, limit }) => {
    const repo = await assertGitRepo(repo_path);

    const args = ["grep", "--line-number", "--no-color", "-E"];
    if (!case_sensitive) args.push("--ignore-case");
    // `-e` marks the next argument as the pattern, so a pattern beginning with
    // '-' can't be mistaken for a flag.
    args.push("-e", pattern);
    if (glob) args.push("--", glob);

    // git grep exits 1 to mean "no matches" and 2+ for real errors, so we read
    // the exit code rather than treating any non-zero exit as a failure.
    const { stdout, stderr, code } = await gitRaw(repo, args);

    if (code === 1 && !stdout.trim()) {
      return ok({ repo, pattern, glob, count: 0, matches: [], note: "No matches found." });
    }
    if (code > 1) {
      throw new ToolError(
        `git grep failed: ${stderr.trim() || `exit code ${code}`}`,
        "Check that `pattern` is a valid extended regular expression.",
      );
    }

    const matches = stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => {
        const [file, lineNumber, ...rest] = line.split(":");
        return { file, line: Number(lineNumber), text: rest.join(":").trim() };
      });

    return ok({ repo, pattern, glob, count: matches.length, matches });
  }),
);

// ---------------------------------------------------------------------------
// Resource — server configuration
// ---------------------------------------------------------------------------

server.registerResource(
  "settings",
  "gitinspector://config/settings",
  {
    title: "git-inspector settings",
    description: "Static configuration for this server: version, defaults, and capabilities.",
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
            transport: "stdio",
            default_repo_path: process.env.DEFAULT_REPO_PATH ?? process.cwd(),
            defaults: {
              recent_commits_limit: 20,
              diff_rev_range: "HEAD~1..HEAD",
              search_limit: 50,
            },
            tools: ["git_recent_commits", "git_diff_stats", "git_search_files"],
            error_handling:
              "Tool failures are returned as results with isError=true, never as protocol errors.",
          },
          null,
          2,
        ),
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Prompt template — standup_report
// ---------------------------------------------------------------------------

server.registerPrompt(
  "standup_report",
  {
    title: "Daily standup report",
    description:
      "Prompt template that turns a repository's recent commits into a daily standup update.",
    argsSchema: {
      repo_path: z.string().describe("Absolute path to the repository to report on."),
      author: z.string().optional().describe("Author to report for. Omit for all authors."),
      since: z.string().optional().describe("How far back to look. Defaults to '1 day ago'."),
    },
  },
  ({ repo_path, author, since }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Write my daily standup for the repository at ${repo_path}.`,
            "",
            "Steps:",
            `1. Call git_recent_commits with repo_path='${repo_path}', since='${since ?? "1 day ago"}'${
              author ? `, author='${author}'` : ""
            }.`,
            "2. Call git_diff_stats over the range those commits cover to gauge the size of the work.",
            "3. Write the report as markdown with exactly three sections:",
            "   **Yesterday** — what was completed, grouped by theme, not one bullet per commit.",
            "   **Today** — what the in-flight work implies is next.",
            "   **Blockers** — anything the commit messages flag as unfinished, or 'None'.",
            "",
            "Keep it under 150 words. Write in plain sentences a teammate would say out loud.",
          ].join("\n"),
        },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] stdio MCP server ready (v${SERVER_VERSION})`);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal:`, error);
  process.exit(1);
});
