/**
 * Read-only filesystem helpers used by the code-analysis server.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { ToolError } from "./result.js";
import { normalizePath } from "./paths.js";

/** Directories never worth walking for source analysis. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".swift",
  ".md", ".txt", ".json", ".yml", ".yaml", ".toml", ".sh",
]);

export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function assertDirectory(path: string): Promise<string> {
  const abs = normalizePath(path);
  try {
    const info = await stat(abs);
    if (!info.isDirectory()) throw new ToolError(`'${abs}' is not a directory.`);
    return abs;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Directory '${abs}' does not exist or is not readable.`);
  }
}

export async function readTextFile(path: string): Promise<string> {
  const abs = normalizePath(path);
  try {
    const info = await stat(abs);
    if (!info.isFile()) throw new ToolError(`'${abs}' is not a file.`);
    if (info.size > 2 * 1024 * 1024) {
      throw new ToolError(
        `'${abs}' is ${(info.size / 1024 / 1024).toFixed(1)} MB — too large to analyse.`,
        "Point at a single source file rather than a bundle or data dump.",
      );
    }
    return await readFile(abs, "utf8");
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`File '${abs}' does not exist or is not readable.`);
  }
}

/**
 * Recursively lists text files under `root`, skipping vendor directories.
 * `maxFiles` bounds the walk so a tool call can't wander an entire home folder.
 */
export async function walkTextFiles(
  root: string,
  maxFiles = 500,
  maxDepth = 8,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || found.length >= maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip rather than fail the whole call
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;

      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && isTextFile(entry.name)) {
        found.push(full);
      }
    }
  }

  await walk(root, 0);
  return found;
}
