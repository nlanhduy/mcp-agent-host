/**
 * code-analyzer — Part 2.2: local HTTP (Streamable HTTP) MCP server.
 *
 * Same MCP surface as the stdio server, different transport: this one listens
 * on localhost and speaks the Streamable HTTP protocol with session ids, which
 * is what MCP Inspector connects to.
 *
 * Tools here are read-only static analysis over a source tree — deliberately a
 * different domain from the git server so the host has to merge two distinct
 * tool sets.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { relative } from "node:path";
import {
  assertDirectory,
  ok,
  readTextFile,
  safeTool,
  startHttpMcpServer,
  walkTextFiles,
} from "@hw/shared";

const SERVER_NAME = "code-analyzer";
const SERVER_VERSION = "1.0.0";
const PORT = Number(process.env.LOCAL_HTTP_PORT ?? 3001);

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.*)$/i;

/** Control-flow keywords that look like calls but are not function definitions. */
const NOT_A_FUNCTION = new Set([
  "if", "for", "while", "switch", "catch", "return", "with", "do", "else", "elif",
]);

/**
 * Approximate count of the functions defined in a source file.
 *
 * Regex-based rather than parsed, because the server accepts any language. It
 * catches named functions (`function f`, `def f`, `func f`), arrow-function
 * bodies, and indented class methods — and it filters out `if (…) {` and
 * friends, which otherwise dominate the count in any real file.
 */
function countFunctions(source: string): number {
  const named = source.match(/\b(?:function|def|func)\s+\w+/g)?.length ?? 0;
  const arrows = source.match(/=>\s*\{/g)?.length ?? 0;

  const methods =
    source
      .match(
        /^[ \t]{2,}(?:(?:async|private|public|protected|static|get|set)\s+)*(\w+)\s*\([^)]*\)\s*[:{]/gm,
      )
      ?.filter((match) => {
        const name = match.trim().split(/[\s(]/).filter(Boolean).pop() ?? "";
        return !NOT_A_FUNCTION.has(name);
      }).length ?? 0;

  return named + arrows + methods;
}

/**
 * A fresh McpServer per session. The Streamable HTTP transport is stateful, and
 * sharing one server instance across sessions would let notifications leak
 * between clients.
 */
function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // -------------------------------------------------------------------------
  // Tool 1 — analyze_complexity
  // -------------------------------------------------------------------------

  server.registerTool(
    "analyze_complexity",
    {
      title: "Analyse file complexity",
      description:
        "Measure the size and shape of a source file: lines of code, comment ratio, maximum nesting depth, and function count.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to a source file."),
      },
    },
    safeTool("analyze_complexity", async ({ file_path }) => {
      const source = await readTextFile(file_path);
      const lines = source.split("\n");

      let blank = 0;
      let comment = 0;
      let depth = 0;
      let maxDepth = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          blank++;
          continue;
        }
        if (/^(\/\/|#|\*|\/\*)/.test(trimmed)) comment++;

        // A brace-counting depth estimate. Crude — it doesn't understand braces
        // inside strings — but consistent enough to compare files against each
        // other, which is all this metric is for.
        for (const char of trimmed) {
          if (char === "{") {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
          } else if (char === "}") {
            depth = Math.max(0, depth - 1);
          }
        }
      }

      const functions = countFunctions(source);
      const code = lines.length - blank - comment;

      return ok({
        file: file_path,
        total_lines: lines.length,
        code_lines: code,
        comment_lines: comment,
        blank_lines: blank,
        comment_ratio: lines.length ? Number((comment / lines.length).toFixed(3)) : 0,
        max_nesting_depth: maxDepth,
        approx_function_count: functions,
        verdict:
          maxDepth > 6 || code > 500
            ? "Large or deeply nested — a candidate for refactoring."
            : "Within normal range.",
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Tool 2 — find_todos
  // -------------------------------------------------------------------------

  server.registerTool(
    "find_todos",
    {
      title: "Find TODO markers",
      description:
        "Scan a directory tree for TODO, FIXME, HACK, XXX and BUG comments. Use this to surface known unfinished work or blockers.",
      inputSchema: {
        directory: z.string().describe("Absolute path to the directory to scan."),
        max_results: z.number().int().min(1).max(200).default(50),
      },
    },
    safeTool("find_todos", async ({ directory, max_results }) => {
      const root = await assertDirectory(directory);
      const files = await walkTextFiles(root);

      const todos: Array<{ file: string; line: number; marker: string; text: string }> = [];

      for (const file of files) {
        if (todos.length >= max_results) break;
        let source: string;
        try {
          source = await readTextFile(file);
        } catch {
          continue; // unreadable or oversized file — skip, don't fail the scan
        }

        source.split("\n").forEach((line, index) => {
          if (todos.length >= max_results) return;
          const match = line.match(TODO_PATTERN);
          if (match) {
            todos.push({
              file: relative(root, file),
              line: index + 1,
              marker: match[1].toUpperCase(),
              text: match[2].trim().slice(0, 200),
            });
          }
        });
      }

      const byMarker: Record<string, number> = {};
      for (const todo of todos) byMarker[todo.marker] = (byMarker[todo.marker] ?? 0) + 1;

      return ok({
        directory: root,
        files_scanned: files.length,
        count: todos.length,
        by_marker: byMarker,
        todos,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Tool 3 — summarize_file
  // -------------------------------------------------------------------------

  server.registerTool(
    "summarize_file",
    {
      title: "Summarise a source file",
      description:
        "Return a structural outline of a source file: its imports, exported or top-level declarations, and first lines. Cheaper than reading the whole file.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to a source file."),
        max_symbols: z.number().int().min(1).max(100).default(40),
      },
    },
    safeTool("summarize_file", async ({ file_path, max_symbols }) => {
      const source = await readTextFile(file_path);
      const lines = source.split("\n");

      const imports: string[] = [];
      const symbols: Array<{ line: number; declaration: string }> = [];

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (/^(import\b|from\s+\S+\s+import\b|const\s+\w+\s*=\s*require\()/.test(trimmed)) {
          imports.push(trimmed.slice(0, 160));
        } else if (
          symbols.length < max_symbols &&
          /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|def|func)\s+\w/.test(
            trimmed,
          )
        ) {
          symbols.push({ line: index + 1, declaration: trimmed.slice(0, 160) });
        }
      });

      return ok({
        file: file_path,
        total_lines: lines.length,
        import_count: imports.length,
        imports: imports.slice(0, 30),
        symbols,
        head: lines.slice(0, 15).join("\n"),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Resource — the analyser's configuration
  // -------------------------------------------------------------------------

  server.registerResource(
    "settings",
    "codeanalyzer://config/settings",
    {
      title: "code-analyzer settings",
      description: "Which markers are scanned for and which file types are considered source.",
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
              endpoint: `http://localhost:${PORT}/mcp`,
              markers: ["TODO", "FIXME", "HACK", "XXX", "BUG"],
              walk_limits: { max_files: 500, max_depth: 8 },
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

startHttpMcpServer({ createServer, port: PORT, serverName: SERVER_NAME });
