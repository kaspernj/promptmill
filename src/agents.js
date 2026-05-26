// @ts-check
import {defaultClaudeArgs, defaultGeminiArgs, ensureStreamJsonVerbose} from "./defaults.js"
import {createClaudeStreamRenderer} from "./render-claude-stream.js"
import {createGeminiStreamRenderer} from "./render-gemini-stream.js"

/**
 * @typedef {object} Agent
 * @property {string} name - Agent identifier (matches the --agent value).
 * @property {string} command - Default executable to spawn.
 * @property {string} label - Console banner label.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {(maxTurns: number, outputFormat: "pretty" | "text" | "json" | "stream-json", passthroughArgs: string[]) => string[]} buildArgs - Builds the agent's CLI args.
 * @property {(prefix: string, sinks: import("node:stream").Writable[]) => {write: (chunk: Buffer | string) => void, flush: () => void}} createRenderer - Live `pretty` stream renderer.
 */

/** @type {Agent} */
const claude = {
  name: "claude",
  command: "claude",
  label: "Claude",
  logDir: ".claude-runs",
  logFilePrefix: "claude-run-",
  buildArgs: (maxTurns, outputFormat, passthroughArgs) =>
    ensureStreamJsonVerbose([...defaultClaudeArgs(maxTurns, outputFormat), ...passthroughArgs]),
  createRenderer: createClaudeStreamRenderer
}

/** @type {Agent} */
const gemini = {
  name: "gemini",
  command: "gemini",
  label: "Gemini",
  logDir: ".gemini-runs",
  logFilePrefix: "gemini-run-",
  // Gemini reads the prompt from stdin (no -p) and has no turn-limit CLI flag.
  buildArgs: (_maxTurns, outputFormat, passthroughArgs) => [...defaultGeminiArgs(outputFormat), ...passthroughArgs],
  createRenderer: createGeminiStreamRenderer
}

/** @type {Record<string, Agent>} */
const AGENTS = {claude, gemini}

/** Agent identifiers accepted by `--agent`. */
export const AGENT_NAMES = Object.keys(AGENTS)

/**
 * Looks up an agent by name.
 * @param {string} name - Agent identifier.
 * @returns {Agent} - The matching agent.
 * @throws {Error} When the name is not a known agent.
 */
export function getAgent(name) {
  const agent = AGENTS[name]

  if (!agent) throw new Error(`Unknown agent: ${name}. Use ${AGENT_NAMES.join(", ")}.`)

  return agent
}
