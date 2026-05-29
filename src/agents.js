// @ts-check
import {defaultAntigravityArgs, defaultClaudeArgs, defaultCodexArgs, defaultGeminiArgs, ensureStreamJsonVerbose} from "./defaults.js"
import {createClaudeStreamRenderer} from "./render-claude-stream.js"
import {createCodexStreamRenderer} from "./render-codex-stream.js"
import {createGeminiStreamRenderer} from "./render-gemini-stream.js"

/**
 * @typedef {object} SessionInfo
 * @property {string} agentName - Agent owning this session — used to namespace the mapping so a shared --log-dir cannot cross-pollinate (e.g. a Claude UUID being mistaken for a Codex thread id).
 * @property {string} name - User-facing session name (e.g. "promptmill").
 * @property {string} uuid - Deterministic UUID v5 derived from the name.
 * @property {string | null} capturedId - Agent-assigned session id captured from a previous run, or null when not yet known.
 */

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
 * @property {(maxTurns: number | null, outputFormat: "pretty" | "text" | "json" | "stream-json", passthroughArgs: string[], session: SessionInfo | null) => string[]} buildArgs - Builds the agent's CLI args. `session` may be null when sessions are disabled. `maxTurns` is null when the user did not pass `--max-turns`.
 * @property {(prefix: string, sinks: import("node:stream").Writable[]) => {write: (chunk: Buffer | string) => void, flush: () => void}} [createRenderer] - Live `pretty` stream renderer; omit for agents with no JSON event stream (raw text passthrough).
 * @property {(line: string, session: SessionInfo | null) => string | null} [extractSessionId] - Parses one raw stdout line and returns the id to persist when the line confirms the session was created. For agents that assign their own id (Codex, Antigravity) the returned value is the captured id; for agents where the id is preknown (Claude/Gemini) the returned value is `session.uuid` on a positive confirmation event.
 */

/**
 * Renders the Claude/Gemini session args that either create the session on the
 * first run (`--session-id <uuid>`) or resume the already-created one on every
 * subsequent run and invocation (`--resume <uuid>`). Both CLIs treat
 * `--session-id` as strictly create-only and error when the id already exists,
 * so the presence of `session.capturedId` (the derived UUID, written to
 * `<log-dir>/sessions.json` after the first successful run) drives the choice.
 * Returns `[]` when sessions are disabled.
 * @param {SessionInfo | null} session - Session info or null.
 * @returns {string[]} - The args, or `[]`.
 */
function claudeGeminiSessionArgs(session) {
  if (session === null) return []

  const flag = session.capturedId === null ? "--session-id" : "--resume"

  return [flag, session.uuid]
}

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
  // Claude's stream-json `system.init` event confirms the session was created
  // but does not include `session_id` (only `model`). We pre-generate the UUID
  // and pass it via `--session-id`, so on the init confirmation we simply
  // return the same UUID for persistence.
  buildArgs: (maxTurns, outputFormat, passthroughArgs, session) => {
    // text mode has no stream-json events → session capture cannot fire. Force
    // stream-json for the first capture run; subsequent runs honor text mode.
    const needsCapture = session !== null && session.capturedId === null
    const effectiveFormat = needsCapture && outputFormat === "text" ? "stream-json" : outputFormat

    return ensureStreamJsonVerbose([
      ...defaultClaudeArgs(maxTurns, effectiveFormat, claudeGeminiSessionArgs(session)),
      ...passthroughArgs
    ])
  },
  extractSessionId: (line, session) => {
    if (!line.includes('"type":"system"')) return null

    try {
      const event = JSON.parse(line)

      return event?.type === "system" && event?.subtype === "init" ? (session?.uuid ?? null) : null
    } catch {
      return null
    }
  },
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
  // Gemini's stream-json init event embeds session_id directly, so the
  // extractor parses it from the line.
  buildArgs: (_maxTurns, outputFormat, passthroughArgs, session) => {
    // text mode has no stream-json events → force stream-json for the first
    // capture run so the init event is visible.
    const needsCapture = session !== null && session.capturedId === null
    const effectiveFormat = needsCapture && outputFormat === "text" ? "stream-json" : outputFormat

    return [...defaultGeminiArgs(effectiveFormat, claudeGeminiSessionArgs(session)), ...passthroughArgs]
  },
  extractSessionId: (line, _session) => {
    if (!line.includes('"type":"init"')) return null

    try {
      const event = JSON.parse(line)

      return event?.type === "init" && typeof event.session_id === "string" ? event.session_id : null
    } catch {
      return null
    }
  },
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
  modelArg: (model) => ["-m", model],
  levelArg: (level) => ["-c", `model_reasoning_effort="${level}"`],
  // `codex exec` text mode streams progress to stderr; only the final message
  // is on stdout, so keep stderr off the live console to stay "final result only".
  textProgressOnStderr: true,
  // `codex exec` reads the prompt from stdin (trailing -); no turn-limit flag.
  // When we have a captured Codex session id, prepend `resume <id>` so the agent
  // resumes that thread. Otherwise start fresh — we'll capture the new id from
  // the `--json` stream's thread.started event. In `text` mode `--json` is
  // normally omitted, but the extractor only sees thread.started in the JSON
  // stream, so we force `--json` for the first capture run. Subsequent runs
  // already have the id and honor the user's chosen output format.
  buildArgs: (_maxTurns, outputFormat, passthroughArgs, session) => {
    const resumeArgs = session?.capturedId ? ["resume", session.capturedId] : []
    const needsCapture = session !== null && session.capturedId === null
    const effectiveFormat = needsCapture && outputFormat === "text" ? "json" : outputFormat

    return defaultCodexArgs(effectiveFormat, passthroughArgs, resumeArgs)
  },
  extractSessionId: (line, _session) => {
    if (!line.includes("thread.started")) return null

    try {
      const event = JSON.parse(line)

      return event?.type === "thread.started" && typeof event.thread_id === "string" ? event.thread_id : null
    } catch {
      return null
    }
  },
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
  // Pin a previously captured conversation via `--conversation <id>` when known;
  // otherwise run fresh (the conversation id, if any, may be captured by
  // `extractSessionId` from the printed text).
  buildArgs: (_maxTurns, _outputFormat, passthroughArgs, session) => {
    const sessionArgs = session?.capturedId ? ["--conversation", session.capturedId] : []

    return defaultAntigravityArgs(passthroughArgs, sessionArgs)
  },
  extractSessionId: (line, _session) => {
    // Best-effort: agy --print does not currently document a machine-readable
    // conversation id in its output, so this matches a few plausible shapes and
    // returns null when nothing is found. Treat all four agents uniformly even
    // if Antigravity rarely yields a capture.
    const match = /(?:conversation(?:[ _-]?id)?|session(?:[ _-]?id)?)[:= ]\s*([A-Za-z0-9_-]{6,})/i.exec(line)

    return match ? match[1] : null
  }
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
