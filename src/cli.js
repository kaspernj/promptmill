// @ts-check
import fs from "node:fs"
import path from "node:path"

import {DEFAULTS, OUTPUT_FORMATS, defaultClaudeArgs, ensureStreamJsonVerbose} from "./defaults.js"
import {integerOption} from "./helpers.js"
import {runAgentBatch} from "./run-agent-batch.js"
import {terminateChild} from "./run-agent-process.js"
import {createStopController} from "./stop-controller.js"

const HELP_TEXT = `Usage: promptmill <prompt-file> [options] [-- <agent args...>]

Runs an agent command repeatedly against a prompt file, tee-ing each run to the
console and a per-run log file.

Options:
  --runs <n>             Number of runs (default ${DEFAULTS.runs}, min 0). Env: RUNS
  --max-turns <n>        Max agent turns per run (default ${DEFAULTS.maxTurns}, min 1). Env: MAX_TURNS
  --log-dir <path>       Per-run log directory (default ${DEFAULTS.logDir}). Env: LOG_DIR
  --command <cmd>        Agent executable to spawn (default ${DEFAULTS.command})
  --cwd <path>           Working directory (default current directory)
  --output-format <fmt>  Output mode: pretty | text | json | stream-json (default ${DEFAULTS.outputFormat}).
                         pretty streams live, readable progress; stream-json streams raw
                         JSON events; text prints only each run's final result.
  --log-file-prefix <s>  Per-run log filename prefix (default ${DEFAULTS.logFilePrefix})
  --label <s>            Console banner label (default ${DEFAULTS.label})
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
 * @property {string} runsRaw - Raw runs value (flag or env).
 * @property {string} maxTurnsRaw - Raw max-turns value (flag or env).
 * @property {string} logDir - Log directory.
 * @property {string} command - Agent command.
 * @property {string} cwd - Working directory.
 * @property {string} logFilePrefix - Log filename prefix.
 * @property {string} label - Console banner label.
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
    command: DEFAULTS.command,
    cwd: process.cwd(),
    error: null,
    help: false,
    label: DEFAULTS.label,
    logDir: env.LOG_DIR || DEFAULTS.logDir,
    logFilePrefix: DEFAULTS.logFilePrefix,
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

      if (arg === "--runs") {
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

  /** @type {number} */
  let runs
  /** @type {number} */
  let maxTurns

  try {
    runs = integerOption(options.runsRaw, {fallback: DEFAULTS.runs, minimum: 0, name: "runs"})
    maxTurns = integerOption(options.maxTurnsRaw, {fallback: DEFAULTS.maxTurns, minimum: 1, name: "max-turns"})
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
    onInterrupt: () => {
      terminateChild(activeChild)
      process.exit(130)
    },
    stdout: process.stdout
  })

  process.on("SIGINT", () => stopController.handleSignal("SIGINT"))
  process.on("SIGTERM", () => stopController.handleSignal("SIGTERM"))

  const passthroughArgs = options.passthroughArgs
  const outputFormat = options.outputFormat

  const result = await runAgentBatch({
    args: (turns) => ensureStreamJsonVerbose([...defaultClaudeArgs(turns, outputFormat), ...passthroughArgs]),
    command: options.command,
    cwd: options.cwd,
    label: options.label,
    logDir: options.logDir,
    logFilePrefix: options.logFilePrefix,
    maxTurns,
    onSpawn: (child) => {
      activeChild = child
    },
    prefixOutputLines: options.prefixOutputLines,
    promptFile,
    render: outputFormat === "pretty",
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
