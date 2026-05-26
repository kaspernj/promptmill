// @ts-check
import {defaultAntigravityArgs, defaultClaudeArgs, defaultCodexArgs, defaultGeminiArgs, ensureStreamJsonVerbose} from "./defaults.js"
import {createClaudeStreamRenderer} from "./render-claude-stream.js"
import {createCodexStreamRenderer} from "./render-codex-stream.js"
import {createGeminiStreamRenderer} from "./render-gemini-stream.js"

/**
 * @typedef {object} Agent
 * @property {string} name - Agent identifier (matches the --agent value).
 * @property {string} command - Default executable to spawn.
 * @property {string} label - Console banner label.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {boolean} usesMaxTurns - Whether the agent honors a per-run turn limit (`--max-turns`).
 * @property {boolean} [textProgressOnStderr] - Whether the agent's `text` mode streams progress to stderr (only the final result on stdout). When set, promptmill keeps stderr off the live console in `text` mode to preserve the "final result only" contract.
 * @property {string} [defaultModel] - Highest-capability model used by default (omit if the agent has no model flag).
 * @property {string} [defaultLevel] - Highest reasoning level used by default (omit if the agent has no separate level setting).
 * @property {(model: string) => string[]} [modelArg] - Renders a model selection into CLI args (omit if the agent has no model flag).
 * @property {(level: string) => string[]} [levelArg] - Renders a reasoning level into CLI args (omit if the agent has no level setting).
 * @property {(maxTurns: number, outputFormat: "pretty" | "text" | "json" | "stream-json", passthroughArgs: string[]) => string[]} buildArgs - Builds the agent's CLI args.
 * @property {(prefix: string, sinks: import("node:stream").Writable[]) => {write: (chunk: Buffer | string) => void, flush: () => void}} [createRenderer] - Live `pretty` stream renderer; omit for agents with no JSON event stream (raw text passthrough).
 */

/** @type {Agent} */
const claude = {
  name: "claude",
  command: "claude",
  label: "Claude",
  logDir: ".claude-runs",
  logFilePrefix: "claude-run-",
  usesMaxTurns: true,
  defaultModel: "opus",
  defaultLevel: "xhigh",
  modelArg: (model) => ["--model", model],
  levelArg: (level) => ["--effort", level],
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
  usesMaxTurns: false,
  defaultModel: "pro", // highest alias (resolves to gemini-3-pro-preview / gemini-2.5-pro); Gemini has no separate level flag
  modelArg: (model) => ["-m", model],
  // Gemini reads the prompt from stdin (no -p) and has no turn-limit CLI flag.
  buildArgs: (_maxTurns, outputFormat, passthroughArgs) => [...defaultGeminiArgs(outputFormat), ...passthroughArgs],
  createRenderer: createGeminiStreamRenderer
}

/** @type {Agent} */
const codex = {
  name: "codex",
  command: "codex",
  label: "Codex",
  logDir: ".codex-runs",
  logFilePrefix: "codex-run-",
  usesMaxTurns: false,
  defaultModel: "gpt-5.5",
  defaultLevel: "xhigh",
  modelArg: (model) => {
    const normalized = model.toLowerCase().replace(/[\s.-]/g, "");
    if (normalized === "spark" || normalized === "spark53" || normalized === "gpt53spark" || normalized === "gpt53codexspark" || normalized === "codexspark" || normalized === "codexspark53") {
      return ["-m", "gpt-5.3-codex-spark"];
    }
    return ["-m", model];
  },
  levelArg: (level) => ["-c", `model_reasoning_effort="${level}"`],
  // `codex exec` text mode streams progress to stderr; only the final message
  // is on stdout, so keep stderr off the live console to stay "final result only".
  textProgressOnStderr: true,
  // `codex exec` reads the prompt from stdin (trailing -); no turn-limit flag.
  buildArgs: (_maxTurns, outputFormat, passthroughArgs) => defaultCodexArgs(outputFormat, passthroughArgs),
  createRenderer: createCodexStreamRenderer
}

/** @type {Agent} */
const antigravity = {
  name: "antigravity",
  command: "agy",
  label: "Antigravity",
  logDir: ".antigravity-runs",
  logFilePrefix: "antigravity-run-",
  usesMaxTurns: false,
  // `agy --print` reads the prompt from stdin and prints a plain-text response;
  // it has no JSON/event stream, so there is no `pretty` renderer (raw text).
  buildArgs: (_maxTurns, _outputFormat, passthroughArgs) => defaultAntigravityArgs(passthroughArgs)
}

/** @type {Record<string, Agent>} */
const AGENTS = {claude, gemini, codex, antigravity}

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
