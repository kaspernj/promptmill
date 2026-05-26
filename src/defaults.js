// @ts-check

/**
 * @typedef {object} PromptmillDefaults
 * @property {number} runs - Default number of runs.
 * @property {number} maxTurns - Default maximum agent turns per run.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} command - Default agent executable.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {string} label - Default console banner label.
 * @property {"pretty" | "text" | "json" | "stream-json"} outputFormat - Default promptmill output mode.
 */

/** @type {PromptmillDefaults} */
export const DEFAULTS = {
  runs: 100,
  maxTurns: 80,
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
 * @param {number} maxTurns - Maximum agent turns for the run.
 * @param {"pretty" | "text" | "json" | "stream-json"} [outputFormat] - promptmill output mode.
 * @returns {string[]} - CLI arguments for the agent command.
 */
export function defaultClaudeArgs(maxTurns, outputFormat = DEFAULTS.outputFormat) {
  const claudeFormat = outputFormat === "pretty" ? "stream-json" : outputFormat

  return [
    "-p",
    "Follow the full instructions provided on stdin. Run autonomously. Do not ask questions. Do not wait for human input.",
    "--dangerously-skip-permissions",
    "--output-format",
    claudeFormat,
    ...(claudeFormat === "stream-json" ? ["--verbose"] : []),
    "--max-turns",
    String(maxTurns)
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
