# Promptmill

Run an agent prompt repeatedly in a batch loop — feeding a prompt file to an agent CLI N times, and tee-ing each run's output to the console and a per-run log file. Useful for batch-testing an autonomous prompt for consistency. Supports **Claude Code** (default), the **Google Gemini CLI**, the **OpenAI Codex CLI**, and the **Antigravity CLI** (`agy`) via `--agent`.

## Install

```sh
npm install -g promptmill
# or run without installing
npx promptmill prompts/my-prompt.md
```

## Quick start

```sh
promptmill prompts/my-prompt.md --runs 50 --max-turns 60
```

Each run reads the prompt file fresh, spawns the agent with the prompt on stdin, streams stdout/stderr to your terminal, and appends the same output to `.claude-runs/claude-run-<n>-<YYYYMMDD-HHMMSS>.log`. A non-zero run is logged and the batch continues.

## CLI

```
promptmill <prompt-file> [options] [-- <agent args...>]
```

| Option | Default | Env | Description |
| --- | --- | --- | --- |
| `--agent <name>` | `claude` | | Agent to run: `claude`, `gemini`, `codex`, or `antigravity`. Sets the default command, label, and log dir. |
| `--awesometasks <t>` | — | | AwesomeTasks mode. `<t>` is a board/project id, project name, or board URL on `tasks.diestoeckels.de`. The positional `<prompt-file>` becomes optional; without one Promptmill uses its shipped default prompt. Either way, `{{AWESOMETASKS_TARGET}}` in the prompt is replaced with `<t>` before the agent runs. See [AwesomeTasks mode](#awesometasks-mode). |
| `--runs <n>` | `100` (min 0) | `RUNS` | Number of runs |
| `--max-turns <n>` | `80` (min 1) | `MAX_TURNS` | Max agent turns per run (**Claude only** — Gemini has no turn-limit flag) |
| `--log-dir <path>` | per agent | `LOG_DIR` | Per-run log directory (`.claude-runs` / `.gemini-runs`) |
| `--command <cmd>` | the agent's | | Agent executable to spawn (`claude` / `gemini`) |
| `--model <name>` | agent's highest | | Model to use. Defaults to the agent's highest (see below). Antigravity has no model flag. |
| `--level <name>` | agent's highest | | Reasoning level, where it's separate from the model name. Defaults to the agent's highest. Gemini/Antigravity have no level. |
| `--cwd <path>` | current dir | | Working directory |
| `--output-format <fmt>` | `pretty` | | Output mode: `pretty` (live readable progress), `text` (final result only), `json`, or `stream-json` (raw JSON events) |
| `--log-file-prefix <s>` | per agent | | Per-run log filename prefix |
| `--label <s>` | the agent's | | Console banner label |
| `--session-id <name>` | `promptmill` | | Logical session name reused across runs and invocations so the agent resumes the same session each time. See [Sessions](#sessions). |
| `--no-line-prefix` | (prefix on) | | Don't prefix each output line with `[run N/total] ` |
| `-h`, `--help` | | | Show help |

Precedence for `runs` / `max-turns` / `log-dir`: **flag > env var > default**.

### Model & reasoning level

By default promptmill runs each agent at its **highest** model and reasoning level; override with `--model` / `--level`. (These are the highest at time of writing — they live in the agent registry and may need bumping as new models ship.)

| Agent | default `--model` | default `--level` |
| --- | --- | --- |
| claude | `opus` (`--model`) | `xhigh` (`--effort`; scale low/medium/high/xhigh/max) |
| gemini | `pro` (`-m`) | — (no level flag) |
| codex | `gpt-5.5` (`-m`) | `xhigh` (`-c model_reasoning_effort=`) |
| antigravity | — (no model flag) | — (no level flag) |

Passing `--model`/`--level` to an agent that has no such flag (e.g. `--agent antigravity --model …`) is an error.

### Agents

By default promptmill drives **Claude Code** (`claude`). Pass `--agent gemini` to drive the **Google Gemini CLI** instead — it must be installed (`npm i -g @google/gemini-cli`) and authenticated. promptmill runs Gemini headless with `--approval-mode yolo`, feeds the prompt on stdin, and (in the default `pretty` mode) renders Gemini's `stream-json` events into the same live, readable progress. Gemini logs go to `.gemini-runs/`. `--max-turns` applies to Claude only.

```sh
promptmill prompts/my-prompt.md --agent gemini --runs 25
```

Pass `--agent codex` to drive the **OpenAI Codex CLI** — it must be installed and signed in (`codex login`). promptmill runs `codex exec --dangerously-bypass-approvals-and-sandbox`, feeds the prompt on stdin, and (in `pretty` mode) renders Codex's `--json` events (`thread.started`, command executions, file changes, the agent's message, token usage) into live, readable progress. Codex must run **inside a git repository** (its own guard — pass `-- --skip-git-repo-check` to bypass) and logs go to `.codex-runs/`. Codex has no turn limit, so `--max-turns` is ignored.

```sh
promptmill prompts/my-prompt.md --agent codex --runs 25
```

Pass `--agent antigravity` to drive the **Antigravity CLI** (`agy`) — it must be installed and authenticated. promptmill runs `agy --print --dangerously-skip-permissions` (raising `--print-timeout` so long runs aren't cut at 5 min), feeds the prompt on stdin, and prints the agent's text response. Antigravity has **no JSON/event-stream output**, so it is text-only: every output mode (including `pretty`) shows its plain response — there is no live event rendering. Logs go to `.antigravity-runs/`; `--max-turns` is ignored.

```sh
promptmill prompts/my-prompt.md --agent antigravity --runs 25
```

**Stopping:** press Ctrl+C once for a **graceful stop** — the current run finishes, the next one is skipped, and promptmill exits. Press Ctrl+C **again** to interrupt the current run and exit immediately.

Exit codes: `0` all runs finished · `1` fatal (missing prompt file, invalid `runs`/`max-turns`, or an unexpected error) · `130` stopped with Ctrl-C (SIGINT/SIGTERM), gracefully or interrupted. A run that exits non-zero does **not** fail the batch.

## Sessions

By default every promptmill run — and every invocation — resumes the same agent session, named `promptmill`. The first run starts a fresh session; subsequent runs (within the batch and across invocations) continue it, so the agent keeps the memory it built up. Override the name with `--session-id <name>` to keep unrelated batches isolated:

```sh
promptmill prompts/feature-a.md --session-id feature-a
promptmill prompts/feature-b.md --session-id feature-b
```

Per-agent details:

- **Claude** and **Gemini**: promptmill derives a deterministic UUID v5 from the session name (same name → same UUID across machines and time). The first run for a name uses `--session-id <uuid>` to create the session; promptmill then records that UUID as a "session created" marker in `<log-dir>/sessions.json` and every subsequent run (in this batch and future invocations) uses `--resume <uuid>`. (Both CLIs treat `--session-id` as strictly create-only and error on a duplicate id, so the marker is required to avoid `Session ID … is already in use.`)
- **Codex** cannot pin a session id up front. Promptmill runs `codex exec` fresh on first use, captures the assigned thread id from the `--json` stream's `thread.started` event, persists it to `<log-dir>/sessions.json`, and uses `codex exec resume <id>` for every subsequent run.
- **Antigravity** is best-effort. Promptmill scans `agy --print` output for a recognizable conversation id; if found it is persisted and reused via `--conversation <id>`, otherwise each run starts fresh.

The session UUID is printed at startup (`Session: promptmill (b8c4… )`). Delete the entry from `<log-dir>/sessions.json` (or delete the whole file) to force the next run to create a new session under the same name.

## AwesomeTasks mode

Point Promptmill at an AwesomeTasks board on `tasks.diestoeckels.de` instead of giving it a prompt file. The agent (which needs its own `awesometasks` skill / tooling) picks scoped Backlog tasks, moves each to Doing, implements, opens a PR, moves it to Review, and comments the result.

```sh
promptmill --awesometasks https://tasks.diestoeckels.de/boards/42 --agent codex --runs 1
```

`--awesometasks` accepts a board id, project id, project name, or a board URL — the value is forwarded verbatim into the prompt as `{{AWESOMETASKS_TARGET}}` and the agent's skill resolves it against the live API. Each Promptmill run drains every in-scope Backlog task it can find; `--runs N` just repeats the cycle (useful for polling).

The shipped prompt lives at [`src/prompts/awesometasks.md`](src/prompts/awesometasks.md). To use your own instead, pass it as the positional argument — `{{AWESOMETASKS_TARGET}}` placeholders are still substituted:

```sh
promptmill prompts/my-awesometasks-worker.md --awesometasks 113 --agent codex
```

The agent needs valid AwesomeTasks credentials in its environment (see the `awesometasks` skill for the token lookup order). Promptmill itself never touches the API.

## Output

By default (`pretty`) promptmill runs `claude` in `stream-json` under the hood and renders the events into **live, readable progress** — assistant messages, tool calls (`→ Bash: …`, `→ Read: …`), errors, and a final `✓ done (N turns, $cost, time)` summary — so you can watch a long run as it works:

```
[run 1/30] · session started (claude-opus-4-7)
[run 1/30] Reading the repo conventions first.
[run 1/30] → Bash: git rev-parse --abbrev-ref HEAD
[run 1/30] → Read: AGENTS.md
[run 1/30] → Edit: app/auth/session.rb
[run 1/30] ✓ done (14 turns, $0.42, 3m12s)
```

The other modes pass Claude's raw output of that format through unchanged:

```sh
promptmill prompts/my-prompt.md                              # pretty: live readable progress (default)
promptmill prompts/my-prompt.md --output-format stream-json  # raw JSON events (full fidelity for logs/parsing)
promptmill prompts/my-prompt.md --output-format text         # only each run's final result (non-streaming — silent until the run ends)
promptmill prompts/my-prompt.md --output-format json         # a single JSON result object per run
```

> `pretty` assumes Claude's `stream-json` event schema. For a different `--command`, use `stream-json`/`text`/`json` (or `pretty` will simply pass any non-JSON lines through unchanged).

Every output line is prefixed with the run it belongs to, e.g. `[run 3/20] …`, so you always know where you are in the batch. Pass `--no-line-prefix` for unprefixed output (e.g. when piping `--output-format stream-json` to a JSON parser).

## Use a different agent

Point promptmill at another agent CLI with `--command`, and pass extra args after `--` (appended to the default args):

```sh
promptmill prompts/my-prompt.md --command codex -- --some-flag value
```

## Programmatic API

```js
import {runAgentBatch} from "promptmill"

const {runs, failures} = await runAgentBatch({
  promptFile: "prompts/my-prompt.md",
  runs: 10,
  maxTurns: 60,
  logDir: ".claude-runs"
})
```

Also exported: `spawnAgentRun`, `parseCliOptions`, `runCli`, `DEFAULTS`, `defaultClaudeArgs`, `timestampForLogFile`, `integerOption`, `buildLogFileName`.

## Logs

One file per run in the log directory, named `<log-file-prefix><run-number>-<YYYYMMDD-HHMMSS>.log`. Each file holds that run's tee'd stdout/stderr plus a final status line.

## Development

```sh
npm install
npm run all-checks   # typecheck + lint + test
```

## License

MIT
