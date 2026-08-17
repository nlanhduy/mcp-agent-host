---
name: git-summary
description: Inspect recent git history and quantify change size, then return a short 5-bullet summary. Use this for requests like "inspect my recent git history" or "summarize recent changes with stats" when logging to team log is not requested.
---

# Git History Summary

Summarize recent repository work from git history only.

## When to use this

Use this when the user asks to inspect recent git activity, quantify change size, or summarize recent
changes with commit and diff stats.

Do not use this when the user explicitly asks for a standup format or asks to save to team log.

## Inputs

- **repo_path** — repository to inspect. If omitted, use the default repository path from the system prompt.
- **since** — time window for commits. Default to `1 day ago`.

## Steps

### 1. Read recent commits

Call `git-inspector__git_recent_commits` with:

- `repo_path`
- `since`

If zero commits are returned, retry once with `since: "7 days ago"`.

### 2. Quantify change size

Take the `range` field from step 1 and call `git-inspector__git_diff_stats` with:

- `repo_path`
- `rev_range` from step 1

If the range is `abc123..abc123`, use `abc123~1..abc123`.

## Output format

Return exactly 5 bullet points and include these facts:

- commit count
- files changed
- insertions
- deletions
- key changed files and what they imply

## Rules

- Only call these tools: `git-inspector__git_recent_commits`, `git-inspector__git_diff_stats`.
- Do not call `use_skill` again once this skill is loaded.
- Do not call team-log tools.
- Do not invent commit hashes, dates, or counts.
