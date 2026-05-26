// @ts-check
import assert from "node:assert/strict"
import {Writable} from "node:stream"
import test from "node:test"

import {createGeminiStreamRenderer, formatGeminiResult, summarizeGeminiParams} from "../src/render-gemini-stream.js"

/** @returns {{stream: Writable, lines: string[]}} - A writable that records each written line. */
function capture() {
  /** @type {string[]} */
  const lines = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk))
      callback()
    }
  })

  return {lines, stream}
}

/**
 * @param {object[]} events - Gemini stream events.
 * @returns {string} - Newline-delimited JSON.
 */
function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}

test("summarizeGeminiParams prefers common keys then falls back to JSON", () => {
  assert.equal(summarizeGeminiParams("run_shell_command", {command: "npm test"}), "npm test")
  assert.equal(summarizeGeminiParams("read_file", {absolute_path: "/repo/AGENTS.md"}), "/repo/AGENTS.md")
  assert.equal(summarizeGeminiParams("google_web_search", {query: "promptmill"}), "promptmill")
  assert.equal(summarizeGeminiParams("mystery", /** @type {Record<string, string>} */ ({foo: "bar"})), '{"foo":"bar"}')
  assert.equal(summarizeGeminiParams("none", undefined), "")
})

test("formatGeminiResult summarizes success and error", () => {
  assert.equal(
    formatGeminiResult({status: "success", stats: {duration_ms: 65000, tool_calls: 3, total_tokens: 1234}}),
    "✓ done (3 tool calls, 1234 tokens, 1m5s)"
  )
  assert.equal(formatGeminiResult({status: "error", error: {message: "boom"}}), "✗ boom")
})

test("renders a full Gemini stream-json sequence into readable lines", () => {
  const {lines, stream} = capture()
  const renderer = createGeminiStreamRenderer("[run 1/1] ", [stream])

  renderer.write(jsonl([
    {model: "gemini-2.5-pro", session_id: "s1", type: "init"},
    {content: "Reading the repo.\n", role: "assistant", type: "message"},
    {content: "Editing ", delta: true, role: "assistant", type: "message"},
    {content: "the file.\n", delta: true, role: "assistant", type: "message"},
    {parameters: {command: "npm test"}, tool_name: "run_shell_command", type: "tool_use"},
    {output: "boom: failed", status: "error", tool_id: "t1", type: "tool_result"},
    {stats: {duration_ms: 65000, tool_calls: 3, total_tokens: 1234}, status: "success", type: "result"}
  ]))
  renderer.flush()

  const output = lines.join("")

  assert.match(output, /\[run 1\/1\] · session started \(gemini-2\.5-pro\)/)
  assert.match(output, /\[run 1\/1\] Reading the repo\./)
  assert.match(output, /\[run 1\/1\] Editing the file\./) // delta chunks coalesced
  assert.match(output, /\[run 1\/1\] → run_shell_command: npm test/)
  assert.match(output, /\[run 1\/1\] {3}✗ boom: failed/)
  assert.match(output, /\[run 1\/1\] ✓ done \(3 tool calls, 1234 tokens, 1m5s\)/)
})

test("flushes a partial assistant line before a tool line", () => {
  const {lines, stream} = capture()
  const renderer = createGeminiStreamRenderer("", [stream])

  renderer.write(jsonl([
    {content: "Thinking about it", role: "assistant", type: "message"}, // no trailing newline
    {parameters: {command: "ls"}, tool_name: "run_shell_command", type: "tool_use"}
  ]))

  assert.deepEqual(lines, ["Thinking about it\n", "→ run_shell_command: ls\n"])
})

test("buffers a JSON line split across chunks and passes non-JSON through", () => {
  const {lines, stream} = capture()
  const renderer = createGeminiStreamRenderer("", [stream])
  const event = JSON.stringify({model: "gemini-x", type: "init"})

  renderer.write(event.slice(0, 8))
  renderer.write(`${event.slice(8)}\n`)
  renderer.write("not json\n")

  assert.deepEqual(lines, ["· session started (gemini-x)\n", "not json\n"])
})
