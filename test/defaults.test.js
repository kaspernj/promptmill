// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {DEFAULTS, OUTPUT_FORMATS, defaultClaudeArgs} from "../src/defaults.js"

/**
 * @param {string[]} args - Assembled CLI args.
 * @param {string} flag - Flag whose following value to read.
 * @returns {string | undefined} - The value after the flag.
 */
function valueAfter(args, flag) {
  const index = args.indexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

test("the default output format is human-readable text", () => {
  assert.equal(DEFAULTS.outputFormat, "text")
  assert.deepEqual(OUTPUT_FORMATS, ["text", "json", "stream-json"])
})

test("defaultClaudeArgs defaults to text output, without --verbose", () => {
  const args = defaultClaudeArgs(80)

  assert.equal(valueAfter(args, "--output-format"), "text")
  assert.ok(!args.includes("--verbose"))
  assert.equal(valueAfter(args, "--max-turns"), "80")
})

test("stream-json adds --verbose (claude requires it in print mode)", () => {
  const args = defaultClaudeArgs(80, "stream-json")

  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
})

test("json output does not add --verbose", () => {
  const args = defaultClaudeArgs(80, "json")

  assert.equal(valueAfter(args, "--output-format"), "json")
  assert.ok(!args.includes("--verbose"))
})
