// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {DEFAULTS, OUTPUT_FORMATS, defaultAntigravityArgs, defaultClaudeArgs, defaultCodexArgs, defaultGeminiArgs, ensureStreamJsonVerbose} from "../src/defaults.js"

/**
 * @param {string[]} args - Assembled CLI args.
 * @param {string} flag - Flag whose following value to read.
 * @returns {string | undefined} - The value after the flag.
 */
function valueAfter(args, flag) {
  const index = args.indexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

test("the default output mode is pretty", () => {
  assert.equal(DEFAULTS.outputFormat, "pretty")
  assert.deepEqual(OUTPUT_FORMATS, ["pretty", "text", "json", "stream-json"])
})

test("defaultClaudeArgs defaults to pretty, which runs Claude in stream-json with --verbose", () => {
  const args = defaultClaudeArgs(80)

  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
  assert.equal(valueAfter(args, "--max-turns"), "80")
})

test("explicit pretty maps to stream-json with --verbose", () => {
  const args = defaultClaudeArgs(80, "pretty")

  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
})

test("explicit text output runs Claude in text without --verbose", () => {
  const args = defaultClaudeArgs(80, "text")

  assert.equal(valueAfter(args, "--output-format"), "text")
  assert.ok(!args.includes("--verbose"))
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

test("defaultGeminiArgs maps pretty to stream-json with approval-mode yolo", () => {
  const args = defaultGeminiArgs("pretty")

  assert.equal(valueAfter(args, "--approval-mode"), "yolo")
  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(!args.includes("--verbose"))
})

test("defaultGeminiArgs passes text and json through", () => {
  assert.equal(valueAfter(defaultGeminiArgs("text"), "--output-format"), "text")
  assert.equal(valueAfter(defaultGeminiArgs("json"), "--output-format"), "json")
})

test("defaultCodexArgs uses exec --json for non-text modes and reads stdin", () => {
  for (const format of ["pretty", "json", "stream-json"]) {
    const args = defaultCodexArgs(/** @type {"pretty" | "json" | "stream-json"} */ (format))

    assert.equal(args[0], "exec")
    assert.ok(args.includes("--json"))
    assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"))
    assert.equal(args.at(-1), "-")
  }
})

test("defaultCodexArgs omits --json for text mode", () => {
  const args = defaultCodexArgs("text")

  assert.ok(!args.includes("--json"))
  assert.equal(args.at(-1), "-")
})

test("defaultCodexArgs inserts passthrough before the trailing stdin -", () => {
  assert.deepEqual(defaultCodexArgs("text", ["--cd", "/repo"]).slice(-3), ["--cd", "/repo", "-"])
})

test("defaultAntigravityArgs runs --print with auto-approve and a long print timeout", () => {
  const args = defaultAntigravityArgs()

  assert.ok(args.includes("--print"))
  assert.ok(args.includes("--dangerously-skip-permissions"))
  assert.equal(valueAfter(args, "--print-timeout"), "1h")
})

test("defaultAntigravityArgs appends passthrough", () => {
  assert.deepEqual(defaultAntigravityArgs(["--add-dir", "/extra"]).slice(-2), ["--add-dir", "/extra"])
})

test("ensureStreamJsonVerbose leaves a text default untouched", () => {
  const args = defaultClaudeArgs(80)

  assert.deepEqual(ensureStreamJsonVerbose(args), args)
})

test("ensureStreamJsonVerbose adds --verbose when passthrough overrides to stream-json", () => {
  // Mirrors `promptmill --output-format text ... -- --output-format stream-json`:
  // a non-verbose base is overridden at the end of argv, but --verbose was not
  // carried along.
  const args = [...defaultClaudeArgs(80, "text"), "--output-format", "stream-json"]

  assert.ok(!args.includes("--verbose")) // precondition: the broken shape
  assert.ok(ensureStreamJsonVerbose(args).includes("--verbose"))
})

test("ensureStreamJsonVerbose does not duplicate an existing --verbose", () => {
  const args = defaultClaudeArgs(80, "stream-json")
  const result = ensureStreamJsonVerbose(args)

  assert.deepEqual(result, args)
  assert.equal(result.filter((arg) => arg === "--verbose").length, 1)
})

test("ensureStreamJsonVerbose ignores a stream-json that a later flag overrides", () => {
  // Effective (last-wins) format is text, so no --verbose should be added.
  const args = [...defaultClaudeArgs(80, "stream-json"), "--output-format", "text"]
    .filter((arg) => arg !== "--verbose")

  assert.ok(!ensureStreamJsonVerbose(args).includes("--verbose"))
})
