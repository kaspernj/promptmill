// @ts-check
import {spawn} from "node:child_process"

/**
 * @typedef {object} AgentRunStatus
 * @property {number} code - Exit code (1 when the process errored or was signaled).
 * @property {string | null} [signal] - Terminating signal, when the process was killed by one.
 */

/**
 * Spawns a single agent run: writes the prompt to the child's stdin and tees
 * the child's stdout/stderr to both the live streams and the per-run log
 * stream. Never rejects — process errors and signals resolve to a status.
 * @param {object} args - Options.
 * @param {string} args.command - Executable to spawn.
 * @param {string[]} args.args - Arguments for the command.
 * @param {string} args.prompt - Prompt text written to the child's stdin.
 * @param {string} args.cwd - Working directory for the child.
 * @param {import("node:stream").Writable} args.stdout - Live stdout sink.
 * @param {import("node:stream").Writable} args.stderr - Live stderr sink.
 * @param {import("node:stream").Writable} args.logStream - Per-run log sink.
 * @param {(child: import("node:child_process").ChildProcess) => void} [args.onSpawn] - Receives the spawned child.
 * @returns {Promise<AgentRunStatus>} - Resolves with the run status.
 */
export function spawnAgentRun({command, args, prompt, cwd, stdout, stderr, logStream, onSpawn}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {cwd, stdio: ["pipe", "pipe", "pipe"]})

    if (onSpawn) {
      onSpawn(child)
    }

    child.stdout?.on("data", (chunk) => {
      stdout.write(chunk)
      logStream.write(chunk)
    })

    child.stderr?.on("data", (chunk) => {
      stderr.write(chunk)
      logStream.write(chunk)
    })

    child.stdin?.on("error", () => {})
    child.stdin?.end(prompt)

    child.on("error", (error) => {
      logStream.write(`${error.stack || error.message}\n`)
      resolve({code: 1})
    })

    child.on("close", (code, signal) => {
      if (signal) {
        resolve({code: 1, signal})
      } else {
        resolve({code: code === null ? 1 : code})
      }
    })
  })
}
