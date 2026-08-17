/**
 * Skill engine (Part 3), following the Anthropic Agent Skills pattern.
 *
 * The pattern is progressive disclosure in two levels:
 *
 *   Level 1 — every skill's `name` and `description` go into the system prompt.
 *             Cheap, always present, and enough for the model to recognise that
 *             a request matches a skill.
 *   Level 2 — the full SKILL.md body is loaded only when the model calls
 *             `use_skill`. The detailed workflow never occupies context until
 *             it is actually needed.
 *
 * This is what makes natural-language triggering work without slash commands:
 * the model matches the request against the descriptions it already has.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

export interface Skill {
  name: string;
  description: string;
  /** Everything below the YAML frontmatter — the actual instructions. */
  body: string;
  path: string;
  /**
   * Tools the skill is not complete without, from the optional `required_tools`
   * frontmatter key. The agent loop refuses to answer while any are unused.
   *
   * Prose alone does not hold a 4B model to a multi-step workflow: it reliably
   * performs the first step, writes a convincing report, and drops the rest.
   * Declaring the contract in data lets the host enforce it.
   */
  requiredTools: string[];
}

/**
 * Loads `<skillsDir>/<skill>/SKILL.md`. A malformed skill is warned about and
 * skipped rather than crashing the host at startup.
 */
export async function loadSkills(skillsDir: string): Promise<Skill[]> {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    console.warn(`[skills] No skills directory at ${skillsDir} — continuing without skills.`);
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(skillsDir, entry.name, "SKILL.md");

    try {
      await stat(path);
    } catch {
      continue; // directory without a SKILL.md — not a skill
    }

    try {
      const raw = await readFile(path, "utf8");
      const { data, content } = matter(raw);

      const name = typeof data.name === "string" ? data.name : entry.name;
      const description = typeof data.description === "string" ? data.description : "";

      if (!description) {
        console.warn(
          `[skills] ${path} has no 'description' in its frontmatter; the model will not know when to use it.`,
        );
      }

      const requiredTools = Array.isArray(data.required_tools)
        ? data.required_tools.filter((tool: unknown): tool is string => typeof tool === "string")
        : [];

      skills.push({ name, description, body: content.trim(), path, requiredTools });
    } catch (error) {
      console.warn(
        `[skills] Failed to load ${path}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return skills;
}

/**
 * Renders the skill index injected into the system prompt.
 *
 * The instruction sentence is doing the real work here: without an explicit
 * "call use_skill FIRST", a small model tends to improvise the workflow from
 * the description alone instead of loading the actual steps.
 */
export function renderSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const rows = skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");

  return [
    "## Available skills",
    "",
    rows,
    "",
    "When the user's request matches one of these skills, your FIRST action must be to call",
    "the `use_skill` tool with that skill's name. It returns step-by-step instructions.",
    "Follow those instructions exactly, calling the tools they name in the order given.",
    "Do not guess the steps of a skill from its description alone.",
  ].join("\n");
}

/** Looks a skill up by name, tolerating case and separator differences. */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
  const normalise = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
  const target = normalise(name);
  return skills.find((skill) => normalise(skill.name) === target);
}
