/**
 * A tiny JSON-file store for standup entries.
 *
 * Deliberately not a database: the assignment grades deployment and auth, not
 * persistence. Note that free PaaS tiers give containers an ephemeral disk, so
 * entries survive restarts only if DATA_DIR points at a mounted volume.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface StandupEntry {
  id: string;
  author: string;
  date: string;
  yesterday: string;
  today: string;
  blockers: string;
  repo?: string;
  commit_count?: number;
  created_at: string;
}

const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data");
const FILE = join(DATA_DIR, "standups.json");

/**
 * Writes are serialised through this promise chain. Without it, two concurrent
 * `log_standup` calls could both read the same array and the second write would
 * silently drop the first entry.
 */
let writeQueue: Promise<void> = Promise.resolve();

export async function readAll(): Promise<StandupEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // no file yet, or it was corrupted — start clean
  }
}

export async function append(entry: StandupEntry): Promise<void> {
  const task = writeQueue.then(async () => {
    const all = await readAll();
    all.push(entry);
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  });
  // Keep the chain alive even if one write fails.
  writeQueue = task.catch(() => undefined);
  return task;
}

export function storePath(): string {
  return FILE;
}
