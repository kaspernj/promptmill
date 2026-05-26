// @ts-check
import fs from "node:fs"
import path from "node:path"

import {AGENT_NAMES, getAgent} from "./agents.js"
import {DEFAULTS, OUTPUT_FORMATS} from "./defaults.js"
import {integerOption} from "./helpers.js"
import {runAgentBatch} from "./run-agent-batch.js"
import {terminateChild} from "./run-agent-process.js"
import {createStopController} from "./stop-controller.js"

const HELP_TEXT = `Usage: promptmill <prompt-file> [options] [-- <agent args...>]

Runs an agent command repeatedly against a prompt file, tee-ing each run to the
console and a per-run log file.

Options:
  --agent <name>         Agent to run: ${AGENT_NAMES.join(" | ")} (default ${DEFAULTS.agent}).
                         Sets the default command, label, and log dir.
  --runs <n>             Number of runs (default ${DEFAULTS.runs}, min 0). Env: RUNS
  --max-turns <n>        Max agent turns per run (Claude only; default ${DEFAULTS.maxTurns}, min 1). Env: MAX_TURNS
  --log-dir <path>       Per-run log directory (default per agent, e.g. .claude-runs / .gemini-runs). Env: LOG_DIR
  --command <cmd>        Agent executable to spawn (default: the agent's, e.g. claude / gemini)
  --cwd <path>           Working directory (default current directory)
  --output-format <fmt>  Output mode: pretty | text | json | stream-json (default ${DEFAULTS.outputFormat}).
                         pretty streams live, readable progress; stream-json streams raw
                         JSON events; text prints only each run's final result.
  --log-file-prefix <s>  Per-run log filename prefix (default per agent)
  --label <s>            Console banner label (default: the agent's name)
  --no-line-prefix       Do not prefix each output line with "[run N/total] "
  -h, --help             Show this help

Anything after "--" is appended verbatim to the agent command's arguments.
Precedence for runs/max-turns/log-dir: flag > env var > default.
`

/**
 * @typedef {object} CliOptions
 * @property {boolean} help - Whether help was requested.
 * @property {string | null} error - Parse error message, when invalid.
 * @property {string | null} promptFile - Positional prompt-file path.
 * @property {string} agent - Selected agent name.
 * @property {string} runsRaw - Raw runs value (flag or env).
 * @property {string} maxTurnsRaw - Raw max-turns value (flag or env).
 * @property {string | null} logDir - Log directory (null = derive from the agent).
 * @property {string | null} command - Agent command (null = derive from the agent).
 * @property {string} cwd - Working directory.
 * @property {string | null} logFilePrefix - Log filename prefix (null = derive from the agent).
 * @property {string | null} label - Console banner label (null = derive from the agent).
 * @property {"pretty" | "text" | "json" | "stream-json"} outputFormat - promptmill output mode.
 * @property {boolean} prefixOutputLines - Whether to prefix output lines with the run indicator.
 * @property {string[]} passthroughArgs - Arguments after "--".
 */

/**
 * Parses CLI arguments and environment fallbacks into options. Pure: it does
 * not spawn processes or exit.
 * @param {string[]} argv - Full process argv (i.e. `process.argv`).
 * @param {Record<string, string | undefined>} [env] - Environment for fallbacks.
 * @returns {CliOptions} - Parsed options (with `error` set on invalid input).
 */
export function parseCliOptions(argv, env = process.env) {
  const args = argv.slice(2)

  /** @type {CliOptions} */
  const options = {
    agent: DEFAULTS.agent,
    command: null,
    cwd: process.cwd(),
    error: null,
    help: false,
    label: null,
    logDir: env.LOG_DIR || null,
    logFilePrefix: null,
    maxTurnsRaw: env.MAX_TURNS || String(DEFAULTS.maxTurns),
    outputFormat: DEFAULTS.outputFormat,
    prefixOutputLines: true,
    passthroughArgs: [],
    promptFile: null,
    runsRaw: env.RUNS || String(DEFAULTS.runs)
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--") {
      options.passthroughArgs = args.slice(index + 1)
      break
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true
      continue
    }

    if (arg === "--no-line-prefix") {
      options.prefixOutputLines = false
      continue
    }

    if (arg.startsWith("--")) {
      const value = args[index + 1]

      if (value === undefined) {
        options.error = `Missing value for ${arg}.`
        return options
      }

      index += 1

      if (arg === "--agent") {
        if (!AGENT_NAMES.includes(value)) {
          options.error = `Invalid --agent: ${value}. Use ${AGENT_NAMES.join(", ")}.`
          return options
        }

        options.agent = value
      } else if (arg === "--runs") {
        options.runsRaw = value
      } else if (arg === "--max-turns") {
        options.maxTurnsRaw = value
      } else if (arg === "--log-dir") {
        options.logDir = value
      } else if (arg === "--command") {
        options.command = value
      } else if (arg === "--cwd") {
        options.cwd = path.resolve(value)
      } else if (arg === "--output-format") {
        if (!OUTPUT_FORMATS.includes(value)) {
          options.error = `Invalid --output-format: ${value}. Use ${OUTPUT_FORMATS.join(", ")}.`
          return options
        }

        options.outputFormat = /** @type {"pretty" | "text" | "json" | "stream-json"} */ (value)
      } else if (arg === "--log-file-prefix") {
        options.logFilePrefix = value
      } else if (arg === "--label") {
        options.label = value
      } else {
        options.error = `Unknown option: ${arg}.`
        return options
      }

      continue
    }

    if (options.promptFile === null) {
      options.promptFile = arg
    } else {
      options.error = `Unexpected argument: ${arg}.`
      return options
    }
  }

  if (!options.help && options.promptFile === null) {
    options.error = "Missing required <prompt-file> argument."
  }

  return options
}

/**
 * Resolves the per-run max-turns value for an agent. Agents that do not honor a
 * turn limit (e.g. Gemini) ignore `--max-turns`/`MAX_TURNS` entirely, so an
 * invalid value never fails their runs; only turn-aware agents validate it.
 * @param {{usesMaxTurns: boolean}} agent - The selected agent.
 * @param {string} maxTurnsRaw - Raw max-turns value (flag or env).
 * @returns {number} - The resolved max-turns (the default when unused by the agent).
 * @throws {Error} When the agent honors max-turns and the value is invalid.
 */
export function resolveMaxTurns(agent, maxTurnsRaw) {
  if (!agent.usesMaxTurns) return DEFAULTS.maxTurns

  return integerOption(maxTurnsRaw, {fallback: DEFAULTS.maxTurns, minimum: 1, name: "max-turns"})
}

/**
 * Runs the promptmill CLI.
 * @param {string[]} argv - Full process argv (i.e. `process.argv`).
 * @returns {Promise<number>} - The process exit code.
 */
export async function runCli(argv) {
  const options = parseCliOptions(argv)

  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  if (options.error) {
    process.stderr.write(`${options.error}\n\n${HELP_TEXT}`)
    return 1
  }

  const agent = getAgent(options.agent)

  /** @type {number} */
  let runs
  /** @type {number} */
  let maxTurns

  try {
    runs = integerOption(options.runsRaw, {fallback: DEFAULTS.runs, minimum: 0, name: "runs"})
    maxTurns = resolveMaxTurns(agent, options.maxTurnsRaw)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const promptFile = path.resolve(options.cwd, /** @type {string} */ (options.promptFile))

  if (!fs.existsSync(promptFile)) {
    process.stderr.write(`Missing prompt file: ${promptFile}\n`)
    return 1
  }

  /** @type {import("node:child_process").ChildProcess | null} */
  let activeChild = null

  // First Ctrl+C → graceful stop (finish the current run, skip the next).
  // Second Ctrl+C (or any SIGTERM) → interrupt the current run and exit now.
  const stopController = createStopController({
    onInterrupt: (signal) => {
      terminateChild(activeChild, signal)
      process.exit(130)
    },
    stdout: process.stdout
  })

  process.on("SIGINT", () => stopController.handleSignal("SIGINT"))
  process.on("SIGTERM", () => stopController.handleSignal("SIGTERM"))

  const passthroughArgs = options.passthroughArgs
  const outputFormat = options.outputFormat

  const result = await runAgentBatch({
    args: (turns) => agent.buildArgs(turns, outputFormat, passthroughArgs),
    command: options.command ?? agent.command,
    createRenderer: outputFormat === "pretty" ? agent.createRenderer : undefined,
    cwd: options.cwd,
    label: options.label ?? agent.label,
    logDir: options.logDir ?? agent.logDir,
    logFilePrefix: options.logFilePrefix ?? agent.logFilePrefix,
    maxTurns,
    onSpawn: (child) => {
      activeChild = child
    },
    prefixOutputLines: options.prefixOutputLines,
    promptFile,
    runs,
    shouldStop: stopController.shouldStop
  })

  if (result.stopped) {
    process.stdout.write(`\nStopped gracefully after ${result.results.length} of ${runs} run(s).\n`)

    return 130
  }

  process.stdout.write("\nAll requested runs finished.\n")

  return 0
}
