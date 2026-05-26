// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {AGENT_NAMES, getAgent} from "../src/agents.js"

/**
 * @param {string[]} args - Assembled CLI args.
 * @param {string} flag - Flag whose following value to read.
 * @returns {string | undefined} - The value after the flag.
 */
function valueAfter(args, flag) {
  const index = args.indexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

test("AGENT_NAMES lists the supported agents", () => {
  assert.deepEqual(AGENT_NAMES, ["claude", "gemini", "codex"])
})

test("getAgent throws on an unknown agent", () => {
  assert.throws(() => getAgent("bogus"), /Unknown agent: bogus/)
})

test("the claude agent has Claude defaults", () => {
  const claude = getAgent("claude")

  assert.equal(claude.command, "claude")
  assert.equal(claude.label, "Claude")
  assert.equal(claude.logDir, ".claude-runs")
  assert.equal(claude.logFilePrefix, "claude-run-")
  assert.equal(claude.usesMaxTurns, true)
})

test("claude.buildArgs maps pretty to stream-json with --verbose and includes --max-turns", () => {
  const args = getAgent("claude").buildArgs(80, "pretty", [])

  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
  assert.equal(valueAfter(args, "--max-turns"), "80")
})

test("the gemini agent has Gemini defaults", () => {
  const gemini = getAgent("gemini")

  assert.equal(gemini.command, "gemini")
  assert.equal(gemini.label, "Gemini")
  assert.equal(gemini.logDir, ".gemini-runs")
  assert.equal(gemini.logFilePrefix, "gemini-run-")
  assert.equal(gemini.usesMaxTurns, false)
})

test("gemini.buildArgs uses approval-mode yolo and stream-json, without claude-only flags", () => {
  const args = getAgent("gemini").buildArgs(80, "pretty", [])

  assert.equal(valueAfter(args, "--approval-mode"), "yolo")
  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(!args.includes("--verbose")) // gemini stream-json does not require it
  assert.ok(!args.includes("--max-turns")) // gemini has no turn-limit CLI flag
  assert.ok(!args.includes("-p")) // prompt is read from stdin
})

test("buildArgs appends passthrough args for both agents", () => {
  assert.deepEqual(getAgent("gemini").buildArgs(80, "text", ["-m", "gemini-2.5-pro"]).slice(-2), ["-m", "gemini-2.5-pro"])
  assert.deepEqual(getAgent("claude").buildArgs(80, "text", ["--foo"]).slice(-1), ["--foo"])
})

test("the codex agent has Codex defaults", () => {
  const codex = getAgent("codex")

  assert.equal(codex.command, "codex")
  assert.equal(codex.label, "Codex")
  assert.equal(codex.logDir, ".codex-runs")
  assert.equal(codex.logFilePrefix, "codex-run-")
  assert.equal(codex.usesMaxTurns, false)
})

test("codex.buildArgs runs `exec --json` with sandbox bypass, prompt via trailing stdin -", () => {
  const args = getAgent("codex").buildArgs(80, "pretty", [])

  assert.equal(args[0], "exec")
  assert.ok(args.includes("--json"))
  assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"))
  assert.equal(args.at(-1), "-") // prompt read from stdin
  assert.ok(!args.includes("--max-turns"))
})

test("codex text mode omits --json and passthrough lands before the trailing -", () => {
  const text = getAgent("codex").buildArgs(80, "text", [])

  assert.ok(!text.includes("--json"))

  const withModel = getAgent("codex").buildArgs(80, "pretty", ["-m", "gpt-5.1-codex"])

  assert.deepEqual(withModel.slice(-3), ["-m", "gpt-5.1-codex", "-"]) // passthrough before stdin -
})
