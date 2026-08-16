/**
 * Thin, safe wrapper around the `git` CLI.
 *
 * Every invocation uses `execFile` with an argv array — never a shell string —
 * so a value like `"; rm -rf /"` arriving in a tool argument is passed to git as
 * one literal argument instead of being interpreted by a shell.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { ToolError } from "./result.js";
import { normalizePath } from "./paths.js";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB — plenty for a log or diff.
const TIMEOUT_MS = 20_000;

/**
 * Resolves a caller-supplied path and confirms it is a git working tree.
 * Throws a `ToolError`, which `safeTool` turns into an `isError` result.
 */
export async function assertGitRepo(repoPath: string): Promise<string> {
  const abs = normalizePath(repoPath);

  try {
    const info = await stat(abs);
    if (!info.isDirectory()) {
      throw new ToolError(`'${abs}' is not a directory.`);
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      `Path '${abs}' does not exist or is not readable.`,
      "Pass an absolute path to a directory on this machine.",
    );
  }

  try {
    await execFileAsync("git", ["-C", abs, "rev-parse", "--git-dir"], {
      timeout: TIMEOUT_MS,
    });
  } catch {
    throw new ToolError(
      `'${abs}' is not a git repository.`,
      "Run `git init` there, or point at a directory that already has a .git folder.",
    );
  }

  return abs;
}

/** Runs `git <args>` inside `repoPath` and returns stdout. */
export async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string; message?: string; code?: unknown };
    const detail = (err.stderr || err.message || "unknown error").trim();
    throw new ToolError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Runs git without throwing on a non-zero exit.
 *
 * Some git commands use the exit code as data rather than as failure — most
 * notably `git grep`, which exits 1 to mean "no matches". Callers that care
 * about the distinction use this instead of `git()`.
 */
export async function gitRaw(
  repoPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", repoPath, ...args], {
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (err.killed) {
      throw new ToolError(`git ${args[0]} timed out after ${TIMEOUT_MS / 1000}s.`);
    }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
}

/**
 * `git log` with a delimiter-separated format. Using unit/record separators
 * rather than newlines keeps multi-line commit bodies intact.
 */
const FIELD = "\u001f"; // ASCII unit separator
const RECORD = "\u001e"; // ASCII record separator
const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s", "%b"].join(FIELD) + RECORD;

export interface LogOptions {
  since?: string;
  until?: string;
  author?: string;
  limit?: number;
  revRange?: string;
}

export async function readCommits(
  repoPath: string,
  options: LogOptions = {},
): Promise<Commit[]> {
  const args = ["log", `--pretty=format:${LOG_FORMAT}`];

  if (options.limit) args.push(`-n${options.limit}`);
  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);
  if (options.author) args.push(`--author=${options.author}`);
  // `--` terminates option parsing so a rev range can never be read as a flag.
  if (options.revRange) args.push(options.revRange);
  args.push("--");

  const stdout = await git(repoPath, args);

  return stdout
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, email, date, subject, body] =
        record.split(FIELD);
      return {
        hash,
        shortHash,
        author,
        email,
        date,
        subject,
        body: (body ?? "").trim(),
      };
    });
}
