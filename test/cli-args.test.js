// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {parseCliOptions} from "../src/cli.js"

/**
 * @param {string[]} args - CLI args after the program name.
 * @param {Record<string, string | undefined>} [env] - Environment for fallbacks.
 * @returns {ReturnType<typeof parseCliOptions>} - Parsed options.
 */
function parse(args, env = {}) {
  return parseCliOptions(["node", "promptmill", ...args], env)
}

test("defaults are applied for a bare prompt file", () => {
  const options = parse(["prompt.md"])

  assert.equal(options.error, null)
  assert.equal(options.promptFile, "prompt.md")
  assert.equal(options.runsRaw, "100")
  assert.equal(options.maxTurnsRaw, "80")
  assert.equal(options.agent, "claude")
  assert.equal(options.outputFormat, "pretty")
  assert.equal(options.prefixOutputLines, true)
  // command/label/logDir/logFilePrefix are null until resolved from the agent in runCli.
  assert.equal(options.command, null)
  assert.equal(options.logDir, null)
})

test("--output-format pretty parses", () => {
  const options = parse(["prompt.md", "--output-format", "pretty"])

  assert.equal(options.error, null)
  assert.equal(options.outputFormat, "pretty")
})

test("--agent gemini parses", () => {
  const options = parse(["prompt.md", "--agent", "gemini"])

  assert.equal(options.error, null)
  assert.equal(options.agent, "gemini")
})

test("an invalid --agent is flagged without throwing", () => {
  const options = parse(["prompt.md", "--agent", "bard"])

  assert.match(String(options.error), /Invalid --agent: bard\./)
})

test("an explicit --log-dir overrides the agent default", () => {
  const options = parse(["prompt.md", "--agent", "gemini", "--log-dir", ".custom"])

  assert.equal(options.logDir, ".custom")
})

test("--no-line-prefix disables the per-line run prefix", () => {
  const options = parse(["prompt.md", "--no-line-prefix"])

  assert.equal(options.error, null)
  assert.equal(options.prefixOutputLines, false)
})

test("--output-format parses a valid value", () => {
  const options = parse(["prompt.md", "--output-format", "stream-json"])

  assert.equal(options.error, null)
  assert.equal(options.outputFormat, "stream-json")
})

test("an invalid --output-format is flagged without throwing", () => {
  const options = parse(["prompt.md", "--output-format", "bogus"])

  assert.match(String(options.error), /Invalid --output-format: bogus\./)
})

test("an explicit flag wins over an env var and the default", () => {
  const options = parse(["prompt.md", "--runs", "5"], {RUNS: "9"})

  assert.equal(options.runsRaw, "5")
})

test("an env var is used when no flag is given", () => {
  const options = parse(["prompt.md"], {RUNS: "9", LOG_DIR: ".custom-logs"})

  assert.equal(options.runsRaw, "9")
  assert.equal(options.logDir, ".custom-logs")
})

test("args after -- are collected as passthrough", () => {
  const options = parse(["prompt.md", "--command", "codex", "--", "--foo", "bar"])

  assert.equal(options.command, "codex")
  assert.deepEqual(options.passthroughArgs, ["--foo", "bar"])
})

test("a missing prompt file is flagged without throwing", () => {
  const options = parse([])

  assert.match(String(options.error), /Missing required <prompt-file> argument\./)
})

test("an unknown option is reported", () => {
  const options = parse(["prompt.md", "--nope", "x"])

  assert.match(String(options.error), /Unknown option: --nope\./)
})

test("--help is detected", () => {
  const options = parse(["--help"])

  assert.equal(options.help, true)
})
