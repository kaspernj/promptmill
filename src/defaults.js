// @ts-check

/**
 * @typedef {object} PromptmillDefaults
 * @property {string} agent - Default agent name.
 * @property {number} runs - Default number of runs.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} command - Default agent executable.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {string} label - Default console banner label.
 * @property {"pretty" | "text" | "json" | "stream-json"} outputFormat - Default promptmill output mode.
 */

/** @type {PromptmillDefaults} */
export const DEFAULTS = {
  agent: "claude",
  runs: 100,
  logDir: ".claude-runs",
  command: "claude",
  logFilePrefix: "claude-run-",
  label: "Claude",
  outputFormat: "pretty"
}

/**
 * promptmill output modes. `pretty` (the default) renders Claude's stream-json
 * events into live, readable progress; `text` / `json` / `stream-json` pass
 * Claude's raw output of that format through unchanged.
 */
export const OUTPUT_FORMATS = ["pretty", "text", "json", "stream-json"]

/**
 * Builds the default Claude Code CLI arguments for a single autonomous run.
 * `pretty` runs Claude in `stream-json` under the hood (promptmill renders the
 * events); `--verbose` is added whenever the Claude format is `stream-json`,
 * which Claude requires in print mode. `text` and `json` are passed through.
 * @param {number | null} maxTurns - Per-run turn cap, or null to omit (default).
 * @param {"pretty" | "text" | "json" | "stream-json"} [outputFormat] - promptmill output mode.
 * @param {string[]} [sessionArgs] - Optional session-pinning args, prepended (e.g. `["--session-id", "<uuid>"]`).
 * @returns {string[]} - CLI arguments for the agent command.
 */
export function defaultClaudeArgs(maxTurns, outputFormat = DEFAULTS.outputFormat, sessionArgs = []) {
  const claudeFormat = outputFormat === "pretty" ? "stream-json" : outputFormat

  return [
    ...sessionArgs,
    "-p",
    "Follow the full instructions provided on stdin. Run autonomously. Do not ask questions. Do not wait for human input.",
    "--dangerously-skip-permissions",
    "--output-format",
    claudeFormat,
    ...(claudeFormat === "stream-json" ? ["--verbose"] : []),
    ...(maxTurns === null ? [] : ["--max-turns", String(maxTurns)])
  ]
}

/**
 * Enforces Claude's invariant that `--output-format stream-json` requires
 * `--verbose` in print mode, regardless of how the format got onto the command
 * line. The effective format is the last `--output-format` value (matching
 * Claude's own last-wins precedence), so this also covers a stream-json format
 * supplied via trailing passthrough args that overrides the promptmill default.
 * @param {string[]} args - The fully-assembled agent args.
 * @returns {string[]} - The args, with `--verbose` appended when required.
 */
export function ensureStreamJsonVerbose(args) {
  let effectiveFormat = null

  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === "--output-format") effectiveFormat = args[i + 1]
  }

  if (effectiveFormat === "stream-json" && !args.includes("--verbose")) return [...args, "--verbose"]

  return args
}

/**
 * Builds the default Gemini CLI arguments for a single autonomous run. The
 * prompt is supplied via stdin (Gemini runs headless in a non-TTY and reads
 * stdin as the prompt), `--approval-mode yolo` auto-approves tool calls, and
 * `pretty` maps to `stream-json` (promptmill renders the events). Gemini has no
 * turn-limit CLI flag, so `maxTurns` does not apply.
 * @param {"pretty" | "text" | "json" | "stream-json"} [outputFormat] - promptmill output mode.
 * @param {string[]} [sessionArgs] - Optional session-pinning args, prepended (e.g. `["--session-id", "<uuid>"]`).
 * @returns {string[]} - CLI arguments for the gemini command.
 */
export function defaultGeminiArgs(outputFormat = DEFAULTS.outputFormat, sessionArgs = []) {
  const geminiFormat = outputFormat === "pretty" ? "stream-json" : outputFormat

  return [...sessionArgs, "--approval-mode", "yolo", "--output-format", geminiFormat]
}

/**
 * Builds the default OpenAI Codex CLI arguments for a single autonomous run.
 * Uses the non-interactive `codex exec` subcommand, reads the prompt from stdin
 * (the trailing `-`), and `--dangerously-bypass-approvals-and-sandbox` so
 * unattended runs never pause. `--json` (JSONL events) is added for every mode
 * except `text` — `pretty` renders those events; `json`/`stream-json` pass them
 * through raw. Codex has no single-object JSON or turn-limit flag.
 * @param {"pretty" | "text" | "json" | "stream-json"} [outputFormat] - promptmill output mode.
 * @param {string[]} [passthroughArgs] - Extra args, inserted before the trailing stdin `-`.
 * @param {string[]} [resumeArgs] - Resume sub-subcommand args (e.g. `["resume", "<id>"]`), inserted immediately after `exec`.
 * @returns {string[]} - CLI arguments for the codex command.
 */
export function defaultCodexArgs(outputFormat = DEFAULTS.outputFormat, passthroughArgs = [], resumeArgs = []) {
  // `codex exec resume <id>` resumes a previous session — the resume sub-subcommand
  // must come immediately after `exec`. When there's no captured id yet (or no
  // session at all), resumeArgs is empty and `codex exec` starts a fresh session
  // whose id we'll capture from the `--json` stream's `thread.started` event.
  const base = ["exec", ...resumeArgs, ...(outputFormat === "text" ? [] : ["--json"]), "--dangerously-bypass-approvals-and-sandbox"]

  return [...base, ...passthroughArgs, "-"]
}

/**
 * Builds the default Antigravity CLI (`agy`) arguments for a single autonomous
 * run. `--print` runs one prompt non-interactively (read from stdin) and prints
 * the text response; `--dangerously-skip-permissions` auto-approves tools. The
 * `--print-timeout` default (5m) is raised so long autonomous runs are not cut
 * short. Antigravity has no JSON/event output or turn-limit flag, so the
 * promptmill output mode does not change its arguments.
 * @param {string[]} [passthroughArgs] - Extra args, appended (can override the timeout).
 * @param {string[]} [sessionArgs] - Optional session-pinning args, prepended (e.g. `["--conversation", "<id>"]`).
 * @returns {string[]} - CLI arguments for the agy command.
 */
export function defaultAntigravityArgs(passthroughArgs = [], sessionArgs = []) {
  return [...sessionArgs, "--print", "--dangerously-skip-permissions", "--print-timeout", "1h", ...passthroughArgs]
}
