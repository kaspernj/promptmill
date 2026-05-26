# Promptmill

Run an agent prompt repeatedly in a batch loop — feeding a prompt file to an agent CLI N times, and tee-ing each run's output to the console and a per-run log file. Useful for batch-testing an autonomous prompt for consistency. Supports **Claude Code** (default) and the **Google Gemini CLI** via `--agent`.

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
| `--agent <name>` | `claude` | | Agent to run: `claude` or `gemini`. Sets the default command, label, and log dir. |
| `--runs <n>` | `100` (min 0) | `RUNS` | Number of runs |
| `--max-turns <n>` | `80` (min 1) | `MAX_TURNS` | Max agent turns per run (**Claude only** — Gemini has no turn-limit flag) |
| `--log-dir <path>` | per agent | `LOG_DIR` | Per-run log directory (`.claude-runs` / `.gemini-runs`) |
| `--command <cmd>` | the agent's | | Agent executable to spawn (`claude` / `gemini`) |
| `--cwd <path>` | current dir | | Working directory |
| `--output-format <fmt>` | `pretty` | | Output mode: `pretty` (live readable progress), `text` (final result only), `json`, or `stream-json` (raw JSON events) |
| `--log-file-prefix <s>` | per agent | | Per-run log filename prefix |
| `--label <s>` | the agent's | | Console banner label |
| `--no-line-prefix` | (prefix on) | | Don't prefix each output line with `[run N/total] ` |
| `-h`, `--help` | | | Show help |

Precedence for `runs` / `max-turns` / `log-dir`: **flag > env var > default**.

### Agents

By default promptmill drives **Claude Code** (`claude`). Pass `--agent gemini` to drive the **Google Gemini CLI** instead — it must be installed (`npm i -g @google/gemini-cli`) and authenticated. promptmill runs Gemini headless with `--approval-mode yolo`, feeds the prompt on stdin, and (in the default `pretty` mode) renders Gemini's `stream-json` events into the same live, readable progress. Gemini logs go to `.gemini-runs/`. `--max-turns` applies to Claude only.

```sh
promptmill prompts/my-prompt.md --agent gemini --runs 25
```

**Stopping:** press Ctrl+C once for a **graceful stop** — the current run finishes, the next one is skipped, and promptmill exits. Press Ctrl+C **again** to interrupt the current run and exit immediately.

Exit codes: `0` all runs finished · `1` fatal (missing prompt file, invalid `runs`/`max-turns`, or an unexpected error) · `130` stopped with Ctrl-C (SIGINT/SIGTERM), gracefully or interrupted. A run that exits non-zero does **not** fail the batch.

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
