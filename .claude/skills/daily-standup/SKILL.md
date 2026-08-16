---
name: daily-standup
description: Generate a daily standup or status report from a local git repository. Use this whenever the user asks what they worked on, wants a status report, a daily update, a standup, a summary of recent commits, or asks to log their progress for the team.
---

# Daily Standup Generator (Claude Code edition)

Identical workflow to [`skills/daily-standup/SKILL.md`](../../../skills/daily-standup/SKILL.md),
which the custom agent host loads. The only difference is the tool naming: Claude Code prefixes
MCP tools with `mcp__<server>__`, whereas the custom host uses `<server>__`.

Running the same workflow under both hosts is the Part 4 interoperability requirement.

## Steps

### 1. Read the commits

`mcp__git-inspector__git_recent_commits` with `repo_path` (the current working directory unless the
user names another) and `since: "1 day ago"`.

If zero commits come back, retry once with `since: "7 days ago"`. Still empty — say so and stop.

### 2. Measure the size of the work

`mcp__git-inspector__git_diff_stats` with the `range` returned by step 1 as `rev_range`.

### 3. Find blockers

`mcp__code-analyzer__find_todos` with `directory` set to the repository path. `FIXME` and `BUG`
markers are blockers; `TODO` markers belong under **Today**.

### 4. Write the standup

Markdown, exactly three sections — **Yesterday** (commits grouped by theme, with the diff size),
**Today** (what the in-flight work implies), **Blockers** (FIXME/BUG markers, or "None"). Under
150 words, no commit hashes, no bullet-per-commit.

### 5. Record it

`mcp__team-log__log_standup` with `author`, `yesterday`, `today`, `blockers`, `repo`, and
`commit_count`.

### 6. Show the user

Print the standup, then confirm it was saved.

## Rules

- Every fact comes from a tool result. Never invent commits, dates, files or counts.
- On a tool error: read the message, fix the arguments, retry once, then report the failure
  honestly rather than fabricating the missing data.
