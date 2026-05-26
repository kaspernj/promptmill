// @ts-check

/**
 * @typedef {object} PromptmillDefaults
 * @property {number} runs - Default number of runs.
 * @property {number} maxTurns - Default maximum agent turns per run.
 * @property {string} logDir - Default per-run log directory.
 * @property {string} command - Default agent executable.
 * @property {string} logFilePrefix - Default per-run log filename prefix.
 * @property {string} label - Default console banner label.
 */

/** @type {PromptmillDefaults} */
export const DEFAULTS = {
  runs: 100,
  maxTurns: 80,
  logDir: ".claude-runs",
  command: "claude",
  logFilePrefix: "claude-run-",
  label: "Claude"
}

/**
 * Builds the default Claude Code CLI arguments for a single autonomous run.
 * @param {number} maxTurns - Maximum agent turns for the run.
 * @returns {string[]} - CLI arguments for the agent command.
 */
export function defaultClaudeArgs(maxTurns) {
  return [
    "-p",
    "Follow the full instructions provided on stdin. Run autonomously. Do not ask questions. Do not wait for human input.",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(maxTurns)
  ]
}
