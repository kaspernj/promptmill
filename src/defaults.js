// @ts-check

/**
 * @typedef {object} PromptmillDefaults
 * @property {number} runs - Default number of runs.
 * @property {number} maxTurns - Default maximum agent turns per run.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} command - Default agent executable.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {string} label - Default console banner label.
 * @property {"text" | "json" | "stream-json"} outputFormat - Default Claude output format.
 */

/** @type {PromptmillDefaults} */
export const DEFAULTS = {
  runs: 100,
  maxTurns: 80,
  logDir: ".claude-runs",
  command: "claude",
  logFilePrefix: "claude-run-",
  label: "Claude",
  outputFormat: "text"
}

/** Output formats Claude Code accepts for `--output-format`. */
export const OUTPUT_FORMATS = ["text", "json", "stream-json"]

/**
 * Builds the default Claude Code CLI arguments for a single autonomous run.
 * `--verbose` is added only for `stream-json`, which Claude requires in print
 * mode; `text` (the default) and `json` are quieter and human-readable.
 * @param {number} maxTurns - Maximum agent turns for the run.
 * @param {"text" | "json" | "stream-json"} [outputFormat] - Claude output format.
 * @returns {string[]} - CLI arguments for the agent command.
 */
export function defaultClaudeArgs(maxTurns, outputFormat = DEFAULTS.outputFormat) {
  return [
    "-p",
    "Follow the full instructions provided on stdin. Run autonomously. Do not ask questions. Do not wait for human input.",
    "--dangerously-skip-permissions",
    "--output-format",
    outputFormat,
    ...(outputFormat === "stream-json" ? ["--verbose"] : []),
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
