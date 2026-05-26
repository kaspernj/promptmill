# Promptmill

Run an agent prompt repeatedly in a batch loop — feeding a prompt file to an agent CLI (Claude Code by default) N times, and tee-ing each run's output to the console and a per-run log file. Useful for batch-testing an autonomous prompt for consistency.

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
| `--runs <n>` | `100` (min 0) | `RUNS` | Number of runs |
| `--max-turns <n>` | `80` (min 1) | `MAX_TURNS` | Max agent turns per run |
| `--log-dir <path>` | `.claude-runs` | `LOG_DIR` | Per-run log directory |
| `--command <cmd>` | `claude` | | Agent executable to spawn |
| `--cwd <path>` | current dir | | Working directory |
| `--log-file-prefix <s>` | `claude-run-` | | Per-run log filename prefix |
| `--label <s>` | `Claude` | | Console banner label |
| `-h`, `--help` | | | Show help |

Precedence for `runs` / `max-turns` / `log-dir`: **flag > env var > default**.

Exit codes: `0` all runs finished · `1` fatal (missing prompt file, invalid `runs`/`max-turns`, or an unexpected error) · `130` aborted with Ctrl-C (SIGINT/SIGTERM). A run that exits non-zero does **not** fail the batch.

## Use a different agent

By default promptmill runs `claude` with `--dangerously-skip-permissions --output-format stream-json --verbose --max-turns <n>`. Point it at another agent CLI and pass extra args after `--` (appended to the default args):

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
