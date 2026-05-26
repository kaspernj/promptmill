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
  assert.deepEqual(AGENT_NAMES, ["claude", "gemini"])
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
