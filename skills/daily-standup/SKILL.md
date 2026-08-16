---
name: daily-standup
description: Generate a daily standup or status report from a local git repository. Use this whenever the user asks what they worked on, wants a status report, a daily update, a standup, a summary of recent commits, or asks to log their progress for the team.
---

# Daily Standup Generator

Turn the last day of git activity in a repository into a standup update, then record it in the
shared team log.

## When to use this

The user asks any of: "what did I work on", "generate my daily status report", "write my standup",
"summarise my recent commits", "log my progress".

## Inputs

- **repo_path** — the repository to report on. If the user did not name one, use the default
  repository path given in the system prompt.
- **since** — how far back to look. Default to `1 day ago`.
- **author** — only if the user asks for a specific person. Otherwise omit it.

## Steps

Run these in order. Each step uses the result of the one before it.

### 1. Read the commits

Call `git-inspector__git_recent_commits` with `repo_path` and `since`.

If it returns zero commits, do not continue down this list. Widen `since` to `7 days ago` and try
once more. If that is also empty, tell the user there is no recent activity and stop.

### 2. Measure the size of the work

Take the `range` field from step 1's result and call `git-inspector__git_diff_stats` with that
`rev_range`. This gives files changed and lines added/removed — use it to say whether the day was
a large change or a small one.

If the range's two halves are the same hash (`abc123..abc123`, which happens when there is only
one commit), that range is empty by definition. Use `abc123~1..abc123` instead so the commit's own
changes are counted.

### 3. Find blockers

Call `code-analyzer__find_todos` with `directory` set to the same repository path. Any `FIXME` or
`BUG` marker is a candidate blocker. `TODO` markers are usually just planned work — mention them
under **Today**, not **Blockers**.

### 4. Write the standup

Compose markdown with exactly these three sections:

```
**Yesterday**
- Group the commits by theme. One bullet per theme, not one per commit.
- Include the diff size, e.g. "(12 files, +430/-88)".

**Today**
- What the in-flight work implies comes next. Draw this from unfinished commit
  subjects and TODO markers.

**Blockers**
- FIXME/BUG markers, or "None".
```

Keep it under 150 words. Write it the way someone would say it out loud in a meeting — no commit
hashes, no bullet-per-commit lists.

### 5. Record it — do not skip this step

You have not finished the skill until `team-log__log_standup` has been called and returned
`"saved": true`. Do not write your final answer before that call. Do not substitute any other
tool; `team-log__log_standup` is the only correct one, and it takes no team name.

Call `team-log__log_standup` with:

- `author` — the commit author from step 1 (use the most frequent one)
- `yesterday`, `today`, `blockers` — the three sections you just wrote, as plain text
- `repo` — the repository path
- `commit_count` — the count from step 1

### 6. Show the user

Print the markdown standup from step 4, then one line confirming it was saved to the team log.

## Rules

- Never invent commits, dates, file names or counts. Every fact comes from a tool result.
- Only call tools that exist. The names you need are exactly: `git-inspector__git_recent_commits`,
  `git-inspector__git_diff_stats`, `code-analyzer__find_todos`, `team-log__log_standup`.
- If a tool returns an error, read the message, correct the arguments, and retry once. If it fails
  again, finish the remaining steps you can and tell the user which step failed.
- Step 5 is not optional — the point of the skill is that the report ends up in the shared log.
