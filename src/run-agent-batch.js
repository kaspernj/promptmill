// @ts-check
import fs from "node:fs"
import path from "node:path"

import {defaultClaudeArgs} from "./defaults.js"
import {buildLogFileName, timestampForLogFile} from "./helpers.js"
import {spawnAgentRun} from "./run-agent-process.js"

/**
 * @typedef {object} AgentRunResult
 * @property {number} runNumber - 1-based run index.
 * @property {number} code - Exit code of the run.
 * @property {string | null} [signal] - Terminating signal, when killed by one.
 * @property {string} logFile - Absolute path to the run's log file.
 */

/**
 * @typedef {object} AgentBatchResult
 * @property {number} runs - Configured number of runs.
 * @property {number} failures - Number of runs that exited non-zero.
 * @property {AgentRunResult[]} results - Per-run results (length is the number actually run).
 * @property {boolean} stopped - Whether the batch stopped early because `shouldStop` returned true.
 */

/**
 * @typedef {object} RunAgentBatchOptions
 * @property {string} promptFile - Absolute or cwd-relative path to the prompt file.
 * @property {number} [runs] - Number of runs to perform.
 * @property {number} [maxTurns] - Maximum agent turns per run (passed to the default args).
 * @property {string} [logDir] - Directory for per-run log files.
 * @property {string} [command] - Agent executable to spawn.
 * @property {string[] | ((maxTurns: number) => string[])} [args] - Args for the command, or a factory.
 * @property {string} [cwd] - Working directory for spawns and log-dir resolution.
 * @property {string} [logFilePrefix] - Per-run log filename prefix.
 * @property {string} [label] - Console banner label.
 * @property {boolean} [prefixOutputLines] - Prefix each agent output line with `[run N/total] ` (default true).
 * @property {import("./run-agent-process.js").CreateRenderer} [createRenderer] - Renders the agent's stream-json into readable lines (the `pretty` mode); omit for raw output.
 * @property {boolean} [logStderrOnly] - Send the agent's stderr to the log only, not the live console.
 * @property {import("node:stream").Writable} [stdout] - Live stdout sink.
 * @property {import("node:stream").Writable} [stderr] - Live stderr sink.
 * @property {{log: (message: string) => void}} [logger] - Banner sink.
 * @property {() => boolean} [shouldStop] - Checked before each run; when true, the batch stops without starting another run.
 * @property {(child: import("node:child_process").ChildProcess) => void} [onSpawn] - Receives each spawned child.
 */

/**
 * Runs an agent command repeatedly against a prompt file, tee-ing each run to
 * the console and a per-run log file and continuing past non-zero exits. Does
 * not call `process.exit` — the caller owns exit codes.
 * @param {RunAgentBatchOptions} options - Batch options.
 * @returns {Promise<AgentBatchResult>} - Summary of the batch.
 */
export async function runAgentBatch(options) {
  const {
    promptFile,
    runs = 100,
    maxTurns = 80,
    logDir = ".claude-runs",
    command = "claude",
    args,
    cwd = process.cwd(),
    logFilePrefix = "claude-run-",
    label = "Claude",
    prefixOutputLines = true,
    createRenderer,
    logStderrOnly = false,
    stdout = process.stdout,
    stderr = process.stderr,
    logger = console,
    shouldStop = () => false,
    onSpawn
  } = options

  const resolvedPromptFile = path.resolve(cwd, promptFile)
  const resolvedLogDir = path.resolve(cwd, logDir)
  const commandArgs = typeof args === "function"
    ? args(maxTurns)
    : (args ?? defaultClaudeArgs(maxTurns))

  fs.mkdirSync(resolvedLogDir, {recursive: true})

  /** @type {AgentRunResult[]} */
  const results = []
  let failures = 0
  let stopped = false

  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    if (shouldStop()) {
      stopped = true
      break
    }

    const timestamp = timestampForLogFile()
    const logFile = path.join(resolvedLogDir, buildLogFileName({logFilePrefix, runNumber, timestamp}))
    const logFileDisplay = path.relative(cwd, logFile)

    logger.log(`\n===== ${label} run ${runNumber}/${runs} =====`)
    logger.log(`Log: ${logFileDisplay}\n`)

    const prompt = fs.readFileSync(resolvedPromptFile, "utf8")
    const logStream = fs.createWriteStream(logFile, {flags: "a"})
    const status = await spawnAgentRun({
      args: commandArgs,
      command,
      cwd,
      createRenderer,
      linePrefix: prefixOutputLines ? `[run ${runNumber}/${runs}] ` : "",
      logStderrOnly,
      logStream,
      onSpawn,
      prompt,
      stderr,
      stdout
    })

    if (status.code === 0) {
      writeToBoth(stdout, logStream, `\n${label} run ${runNumber}/${runs} finished successfully.\n`)
    } else {
      failures += 1
      writeToBoth(stdout, logStream, `\n${label} run ${runNumber}/${runs} exited with code ${status.code}. Continuing to next run.\n`)
    }

    await new Promise((resolve) => logStream.end(resolve))

    results.push({code: status.code, logFile, runNumber, signal: status.signal})
  }

  return {failures, results, runs, stopped}
}

/**
 * Writes a message to both the live stdout sink and the per-run log stream.
 * @param {import("node:stream").Writable} stdout - Live stdout sink.
 * @param {import("node:stream").Writable} logStream - Per-run log sink.
 * @param {string} message - Message to write.
 * @returns {void}
 */
function writeToBoth(stdout, logStream, message) {
  stdout.write(message)
  logStream.write(message)
}
