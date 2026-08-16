# MCP Agent Host, Servers & Skills — 22127086

An end-to-end agentic workflow built on the Model Context Protocol: a custom agent host driven by
a local Ollama model, three MCP servers on three different transports, and a skill system that
fires from plain natural language.

```
                   ┌──────────────────────────────────────┐
                   │      Agent Host (MCP client)         │
                   │  config loader · tool merger         │
                   │  Ollama engine · call dispatcher     │
                   │  skill engine (use_skill)            │
                   └───────┬───────────┬──────────────┬───┘
              stdio        │      HTTP │         HTTPS│ + Bearer key
                   ┌───────▼──┐  ┌─────▼──────┐  ┌────▼─────────┐
                   │ git-     │  │ code-      │  │ team-log     │
                   │ inspector│  │ analyzer   │  │ (deployed)   │
                   │ 3 tools  │  │ 3 tools    │  │ 3 tools      │
                   │ 1 resource│ │ 1 resource │  │ 1 resource   │
                   │ 1 prompt │  │            │  │ API key auth │
                   └──────────┘  └────────────┘  └──────────────┘
```

| Package | Part | Transport | What it does |
| --- | --- | --- | --- |
| [`packages/agent-host`](packages/agent-host/) | 1, 3 | — | MCP host: config, tool merging, dispatch, skills |
| [`packages/server-stdio`](packages/server-stdio/) | 2.1 | stdio | `git-inspector` — git log, diff stats, tracked-file search |
| [`packages/server-local-http`](packages/server-local-http/) | 2.2 | Streamable HTTP | `code-analyzer` — complexity, TODO scan, file outline |
| [`packages/server-public-http`](packages/server-public-http/) | 2.3 | Streamable HTTP + auth | `team-log` — standup store, release notes |
| [`packages/shared`](packages/shared/) | — | — | `safeTool`/`isError` helpers, git wrapper, HTTP transport plumbing |

---

## 1. Setup

Requires Node 20+ and [Ollama](https://ollama.com).

```bash
nvm use            # reads .nvmrc (Node 22)
npm install
npm run build

cp .env.example .env   # then edit MCP_API_KEY and DEFAULT_REPO_PATH
ollama pull qwen3:4b
```

### A note on the model

The assignment specifies `qwen3.5:4b`. **No such tag is published on the Ollama library**, so the
default here is `qwen3:4b` — the equivalent lightweight model the spec allows. It is configurable
in three places, highest priority first:

1. `OLLAMA_MODEL` environment variable
2. `llm.model` in `mcp_config.json`
3. the built-in default

**On speed:** `qwen3` is a reasoning model, and its chain-of-thought costs roughly a minute per
tool-calling round on a laptop. `mcp_config.json` therefore sets
`llm.extraBody = {"reasoning_effort": "none"}`, which Ollama honours and which cuts that by about
5×. If a demo still feels slow, `OLLAMA_MODEL=qwen2.5:7b npm run host` uses a non-reasoning model
with solid tool-calling support and is noticeably snappier.

---

## 2. Running everything

Three terminals, or background the first two:

```bash
# terminal 1 — local HTTP server (Part 2.2)
npm run start:local-http           # http://localhost:3001/mcp

# terminal 2 — public HTTP server (Part 2.3), locally
npm run start:public-http          # http://localhost:3002/mcp, API key required

# terminal 3 — the agent host
npm run host
```

No `export` step: every `start:*` and `host` script runs Node with
`--env-file-if-exists=.env`, so `.env` is loaded automatically. Set a variable on the command
line to override a single value for one run:

```bash
OLLAMA_MODEL=qwen2.5:7b npm run host
```

The stdio server is **not** started by hand — the host launches it as a child process, which is
what the stdio transport means.

Expected startup:

```
✓ Connected to http://localhost:11434/v1 using qwen3:4b
✓ code-analyzer (3 tools)
✓ team-log (3 tools)
✓ git-inspector (3 tools)
✓ 1 skill(s) from ./skills

10 tools in context (including use_skill). Type /help for commands.
```

### Host commands

| Command | Effect |
| --- | --- |
| `/tools` | every tool merged from every server, with its namespace |
| `/resources` | list MCP resources; `/resources <uri>` reads one |
| `/prompts` | list MCP prompt templates |
| `/skills` | loaded skills and their descriptions |
| `/reset` | clear conversation history |
| `/exit` | quit |

Anything else goes to the model.

---

## 3. How it works

### Configuration loader — [`config.ts`](packages/agent-host/src/config.ts)

`mcp_config.json` is validated with zod and deliberately shaped like Claude Desktop's config, so
one file format describes the servers to both hosts. `${VAR}` references are expanded from the
environment, which is how the public server's bearer token stays out of git.

### Tool merging — [`mcp-manager.ts`](packages/agent-host/src/mcp-manager.ts)

Each configured server gets an SDK `Client` over the transport its config implies. After
connecting, `listTools()` results are indexed under `<server>__<tool>` — namespacing matters
because the LLM sees one flat list and two servers may both expose a `search`. The same map is the
dispatch table. Servers that fail to start are reported and skipped rather than aborting the host.

### Dispatch loop — [`agent-loop.ts`](packages/agent-host/src/agent-loop.ts)

Send messages → if the reply carries `tool_calls`, route each to its owning server, append the
results as `role: "tool"` messages, and ask again. Two details worth knowing:

- **`isError` propagation.** OpenAI's tool-message format has no error flag, so an errored MCP
  result is prefixed with `ERROR:`. Small models reliably notice that and correct their arguments;
  they often skip past a failure buried inside a JSON blob.
- **Inline tool-call recovery.** Qwen sometimes emits `<tool_call>{...}</tool_call>` as message
  text instead of filling the structured field. Those are parsed back out, which is the difference
  between a working demo and a stuck one.

### Skill engine — [`skills.ts`](packages/agent-host/src/skills.ts)

Progressive disclosure, in two levels:

1. Every skill's `name` and `description` go into the system prompt at startup — cheap, and enough
   for the model to recognise a match.
2. The full `SKILL.md` body loads only when the model calls `use_skill`.

That is what makes *"Generate my daily status report based on my local commits"* work with no
slash command: the model matches the request against descriptions it already has, then pulls the
steps.

### `isError` handling — [`result.ts`](packages/shared/src/result.ts)

`safeTool()` wraps every handler so a thrown error becomes `{isError: true}` in the result rather
than a JSON-RPC protocol error. The distinction matters: protocol errors never reach the model,
tool errors do — and only the latter let it recover.

---

## 4. Verification

### Build

```bash
npm run build && ls packages/*/dist/index.js    # 5 files
```

### stdio server in MCP Inspector

```bash
npm run inspect:stdio
```

Expect 3 tools, 1 resource (`gitinspector://config/settings`), 1 prompt (`standup_report`).

**Demonstrate `isError`:** call `git_recent_commits` with `repo_path: "/nope"`. Inspector shows
the result flagged as an error with a readable message and a hint — not a transport failure.

### Local HTTP server in Inspector

```bash
npm run start:local-http
npm run inspect          # Transport: Streamable HTTP → http://localhost:3001/mcp
```

### Public HTTP server auth

```bash
# no key → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $PUBLIC_URL/mcp \
  -H 'content-type: application/json' -d '{}'

# with key → session established
curl -s -X POST $PUBLIC_URL/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i | head -20
```

In Inspector, add the header `Authorization: Bearer <key>` under *Authentication* before connecting.

### End-to-end

```bash
npm run host
you › Generate my daily status report based on my local commits
```

The transcript should show `use_skill` first, then tool calls across all three servers, then a
markdown standup.

---

## 5. Deploying the public server

The Dockerfile builds from the **repository root** because the server depends on the `@hw/shared`
workspace.

```bash
docker build -f packages/server-public-http/Dockerfile -t team-log .
docker run -p 3002:3002 -e MCP_API_KEY=$MCP_API_KEY team-log
```

### Render (blueprint included)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. [`render.yaml`](render.yaml) is picked up
   automatically.
3. Render prompts for `MCP_API_KEY`. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
4. The endpoint is `https://<service>.onrender.com/mcp`.

The same image runs unchanged on Railway, Fly.io and Cloud Run — they all inject `PORT`.

**Free-tier caveats, stated plainly:** the container sleeps when idle, so hit `/health` once
before recording a demo or the first MCP call waits on a cold start. The disk is ephemeral, so
standup entries are lost on redeploy unless `DATA_DIR` points at a mounted volume.

---

## 6. Claude Code / Claude Desktop (Part 4)

```bash
REPO=$(pwd)

claude mcp add git-inspector -- node $REPO/packages/server-stdio/dist/index.js
claude mcp add --transport http code-analyzer http://localhost:3001/mcp
claude mcp add --transport http team-log https://<YOUR-DEPLOYMENT>.onrender.com/mcp \
  --header "Authorization: Bearer $MCP_API_KEY"

claude mcp list
```

For Claude Desktop, copy [`claude_desktop_config.json`](claude_desktop_config.json) to
`~/Library/Application Support/Claude/claude_desktop_config.json` and replace the three
placeholders. Desktop does not expand `${VAR}`, so absolute paths and the literal key are required
there.

The skill is available to Claude Code as
[`.claude/skills/daily-standup/SKILL.md`](.claude/skills/daily-standup/SKILL.md) — the same
workflow as the host's copy, with Claude Code's `mcp__<server>__<tool>` naming. Asking Claude Code
*"write my standup"* runs the same steps against the same servers.

---

## 7. Demo video script

1. **Stdio server** (~2 min) — `npm run inspect:stdio`. List tools, resources, prompts. Run
   `git_recent_commits` successfully, then with `repo_path: "/nope"` to show `isError`. Render the
   `standup_report` prompt.
2. **Public server** (~2 min) — show the Render dashboard and `/health`. `curl` without the key →
   401. Connect Inspector with the bearer header → tools list and a `log_standup` call.
3. **Agent host** (~3 min) — `npm run host`. Point out the three ✓ lines and the tool count. Run
   `/tools` to show namespaced merging. Then type
   *"Generate my daily status report based on my local commits"* and narrate the trace:
   `use_skill` → `git_recent_commits` → `git_diff_stats` → `find_todos` → `log_standup` → the
   standup. Finish with `list_standups` to prove it persisted.
4. **Dual host** (~1 min) — same request in Claude Code, same servers, same skill.

---

## Submission checklist

- [ ] Repository pushed
- [ ] Public server deployed and awake
- [ ] Public URL + API key recorded for the grader
- [ ] YouTube video uploaded and unlisted/public
