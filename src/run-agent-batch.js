// @ts-check
import fs from "node:fs"
import path from "node:path"

import {defaultClaudeArgs} from "./defaults.js"
import {buildLogFileName, timestampForLogFile} from "./helpers.js"
import {spawnAgentRun} from "./run-agent-process.js"
import {readSessionMapping, writeSessionMapping} from "./session.js"

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
 * @property {string} [promptFile] - Absolute or cwd-relative path to the prompt file. Required unless `promptText` is given.
 * @property {string} [promptText] - Pre-rendered prompt text. Overrides `promptFile` when set; no file read happens.
 * @property {number} [runs] - Number of runs to perform.
 * @property {number | null} [maxTurns] - Maximum agent turns per run, or null to omit the cap. Default null.
 * @property {string} [logDir] - Directory for per-run log files.
 * @property {string} [command] - Agent executable to spawn.
 * @property {string[] | ((maxTurns: number | null, session: import("./agents.js").SessionInfo | null) => string[])} [args] - Args for the command, or a factory invoked once per run with the current session info.
 * @property {import("./agents.js").SessionInfo} [session] - Shared session info reused across runs and invocations; mutated in-place when a capturedId is discovered.
 * @property {(line: string, session: import("./agents.js").SessionInfo | null) => string | null} [extractSessionId] - Parses one raw stdout line and returns the id to persist when the line confirms the session was created.
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
    promptText,
    runs = 100,
    maxTurns = null,
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
    onSpawn,
    session,
    extractSessionId
  } = options

  if (promptText === undefined && promptFile === undefined) {
    throw new Error("runAgentBatch requires either promptFile or promptText.")
  }

  const resolvedPromptFile = promptFile === undefined ? null : path.resolve(cwd, promptFile)
  const resolvedLogDir = path.resolve(cwd, logDir)
  const sessionInfo = session ?? null

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

    const prompt = promptText ?? fs.readFileSync(/** @type {string} */ (resolvedPromptFile), "utf8")
    const logStream = fs.createWriteStream(logFile, {flags: "a"})
    const commandArgs = typeof args === "function"
      ? args(maxTurns, sessionInfo)
      : (args ?? defaultClaudeArgs(maxTurns))

    /** @type {string | null} */
    let newlyCapturedId = null
    const onStdoutLine = extractSessionId && sessionInfo && sessionInfo.capturedId === null
      ? (/** @type {string} */ line) => {
        if (newlyCapturedId !== null) return

        const candidate = extractSessionId(line, sessionInfo)
        if (candidate) newlyCapturedId = candidate
      }
      : undefined

    const status = await spawnAgentRun({
      args: commandArgs,
      command,
      cwd,
      createRenderer,
      linePrefix: prefixOutputLines ? `[run ${runNumber}/${runs}] ` : "",
      logStderrOnly,
      logStream,
      onSpawn,
      onStdoutLine,
      prompt,
      stderr,
      stdout
    })

    // After the extractor confirms the session was created (by emitting the
    // agent-side id we should persist), record it so subsequent runs — in this
    // batch and across invocations — take the "resume" path. The extractor
    // itself is the gate, not the exit code: a Claude run that hits
    // `error_max_turns` (exit 1) has already created the session by the time
    // max-turns fires, so we still want the marker. Keyed by
    // `<agentName>:<sessionName>` so a shared --log-dir cannot cross-
    // pollinate (e.g. a Claude UUID being mistaken for a Codex thread id).
    if (sessionInfo !== null && sessionInfo.capturedId === null && newlyCapturedId !== null) {
      sessionInfo.capturedId = newlyCapturedId
      const mapping = readSessionMapping(resolvedLogDir)
      mapping[`${sessionInfo.agentName}:${sessionInfo.name}`] = newlyCapturedId
      writeSessionMapping(resolvedLogDir, mapping)
    }

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
