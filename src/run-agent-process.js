// @ts-check
import {spawn} from "node:child_process"

/**
 * @typedef {object} AgentRunStatus
 * @property {number} code - Exit code (1 when the process errored or was signaled).
 * @property {string | null} [signal] - Terminating signal, when the process was killed by one.
 */

/**
 * @typedef {(prefix: string, sinks: import("node:stream").Writable[]) => LinePrefixer} CreateRenderer
 */

/**
 * @typedef {object} LinePrefixer
 * @property {(chunk: Buffer | string) => void} write - Buffers a chunk and writes completed prefixed lines.
 * @property {() => void} flush - Writes any buffered partial line, with a trailing newline.
 */

/**
 * Creates a writer that splits input into lines, prepends `prefix` to each, and
 * writes the prefixed lines to every sink. A trailing partial line is buffered
 * until the next newline or an explicit {@link LinePrefixer.flush}.
 * @param {string} prefix - Text prepended to each line.
 * @param {import("node:stream").Writable[]} sinks - Destinations for prefixed lines.
 * @returns {LinePrefixer} - The line-prefixing writer.
 */
function createLinePrefixer(prefix, sinks) {
  let buffer = ""

  return {
    write(chunk) {
      buffer += String(chunk)

      let newlineIndex = buffer.indexOf("\n")

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex + 1)

        for (const sink of sinks) {
          sink.write(prefix + line)
        }

        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf("\n")
      }
    },
    flush() {
      if (buffer.length === 0) return

      for (const sink of sinks) {
        sink.write(`${prefix}${buffer}\n`)
      }

      buffer = ""
    }
  }
}

/**
 * Spawns a single agent run: writes the prompt to the child's stdin and tees
 * the child's stdout/stderr to both the live streams and the per-run log
 * stream. When `linePrefix` is non-empty, each output line is prefixed with it.
 * Never rejects — process errors and signals resolve to a status.
 * @param {object} args - Options.
 * @param {string} args.command - Executable to spawn.
 * @param {string[]} args.args - Arguments for the command.
 * @param {string} args.prompt - Prompt text written to the child's stdin.
 * @param {string} args.cwd - Working directory for the child.
 * @param {import("node:stream").Writable} args.stdout - Live stdout sink.
 * @param {import("node:stream").Writable} args.stderr - Live stderr sink.
 * @param {import("node:stream").Writable} args.logStream - Per-run log sink.
 * @param {string} [args.linePrefix] - Prepended to each output line; empty string passes output through unchanged.
 * @param {CreateRenderer} [args.createRenderer] - Builds a stdout writer that renders the agent's stream-json into readable lines (the `pretty` mode).
 * @param {boolean} [args.logStderrOnly] - Send the child's stderr to the log only, not the live console (e.g. an agent that streams progress to stderr in a "final result only" mode).
 * @param {(child: import("node:child_process").ChildProcess) => void} [args.onSpawn] - Receives the spawned child.
 * @param {(line: string) => void} [args.onStdoutLine] - Optional tap fired for each completed raw stdout line (before renderer/prefixer). Used to capture agent-assigned session ids from stream events.
 * @returns {Promise<AgentRunStatus>} - Resolves with the run status.
 */
export function spawnAgentRun({command, args, prompt, cwd, stdout, stderr, logStream, linePrefix = "", createRenderer, logStderrOnly = false, onSpawn, onStdoutLine}) {
  return new Promise((resolve) => {
    // `detached` puts the child in its own process group, so a terminal Ctrl+C
    // (SIGINT to the foreground group) does not reach it — promptmill decides
    // whether to forward it. Not unref'd: we still await the child's `close`.
    const child = spawn(command, args, {cwd, detached: true, stdio: ["pipe", "pipe", "pipe"]})

    if (onSpawn) {
      onSpawn(child)
    }

    // When logStderrOnly, the child's stderr is captured in the log but kept off
    // the live console, so a "final result only" mode stays quiet on the terminal.
    const errSinks = logStderrOnly ? [logStream] : [stderr, logStream]

    const outWriter = createRenderer
      ? createRenderer(linePrefix, [stdout, logStream])
      : (linePrefix ? createLinePrefixer(linePrefix, [stdout, logStream]) : null)
    const errPrefixer = linePrefix ? createLinePrefixer(linePrefix, errSinks) : null

    // Side-tap for onStdoutLine: split raw stdout into lines and notify the
    // caller for each one. Independent of the renderer so it works in every
    // output mode (pretty/json/stream-json/text).
    let tapBuffer = ""

    /** @param {Buffer | string} chunk - Raw stdout chunk to inspect. */
    function tapStdout(chunk) {
      if (!onStdoutLine) return

      tapBuffer += String(chunk)
      let newlineIndex = tapBuffer.indexOf("\n")

      while (newlineIndex !== -1) {
        onStdoutLine(tapBuffer.slice(0, newlineIndex))
        tapBuffer = tapBuffer.slice(newlineIndex + 1)
        newlineIndex = tapBuffer.indexOf("\n")
      }
    }

    child.stdout?.on("data", (chunk) => {
      tapStdout(chunk)

      if (outWriter) {
        outWriter.write(chunk)
      } else {
        stdout.write(chunk)
        logStream.write(chunk)
      }
    })

    child.stderr?.on("data", (chunk) => {
      if (errPrefixer) {
        errPrefixer.write(chunk)
      } else {
        for (const sink of errSinks) {
          sink.write(chunk)
        }
      }
    })

    child.stdin?.on("error", () => {})
    child.stdin?.end(prompt)

    /** @returns {void} */
    function flushPrefixers() {
      outWriter?.flush()
      errPrefixer?.flush()

      if (onStdoutLine && tapBuffer.length > 0) {
        onStdoutLine(tapBuffer)
        tapBuffer = ""
      }
    }

    child.on("error", (error) => {
      flushPrefixers()
      logStream.write(`${error.stack || error.message}\n`)
      resolve({code: 1})
    })

    child.on("close", (code, signal) => {
      flushPrefixers()

      if (signal) {
        resolve({code: 1, signal})
      } else {
        resolve({code: code === null ? 1 : code})
      }
    })
  })
}

/**
 * Terminates a spawned child and its process group. The child is spawned
 * `detached`, so it leads its own group; killing the negative pid signals the
 * whole group (reaching subprocesses the agent itself spawned). Falls back to
 * a direct kill, and is a no-op for a missing or already-exited child.
 * @param {import("node:child_process").ChildProcess | null} child - The child to terminate.
 * @param {"SIGINT" | "SIGTERM" | "SIGKILL"} [signal] - Signal to send (default SIGTERM).
 * @returns {void}
 */
export function terminateChild(child, signal = "SIGTERM") {
  if (!child || child.pid === undefined) return

  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Child already exited — nothing to terminate.
    }
  }
}
