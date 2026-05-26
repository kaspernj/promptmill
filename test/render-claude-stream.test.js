// @ts-check
import assert from "node:assert/strict"
import {Writable} from "node:stream"
import test from "node:test"

import {createClaudeStreamRenderer, renderClaudeEvent, summarizeToolInput} from "../src/render-claude-stream.js"

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

test("renders an init event with the model", () => {
  assert.deepEqual(
    renderClaudeEvent({model: "claude-opus-4-7", subtype: "init", type: "system"}),
    ["· session started (claude-opus-4-7)"]
  )
})

test("renders assistant text blocks", () => {
  assert.deepEqual(
    renderClaudeEvent({message: {content: [{text: "Reading the repo.", type: "text"}]}, type: "assistant"}),
    ["Reading the repo."]
  )
})

test("renders a Bash tool_use as its command", () => {
  assert.deepEqual(
    renderClaudeEvent({message: {content: [{input: {command: "git status"}, name: "Bash", type: "tool_use"}]}, type: "assistant"}),
    ["→ Bash: git status"]
  )
})

test("renders a Read tool_use as its file path", () => {
  assert.deepEqual(
    renderClaudeEvent({message: {content: [{input: {file_path: "AGENTS.md"}, name: "Read", type: "tool_use"}]}, type: "assistant"}),
    ["→ Read: AGENTS.md"]
  )
})

test("shows tool_result errors and skips successful results", () => {
  assert.deepEqual(
    renderClaudeEvent({message: {content: [{content: "boom", is_error: true, type: "tool_result"}]}, type: "user"}),
    ["  ✗ boom"]
  )
  assert.deepEqual(
    renderClaudeEvent({message: {content: [{content: "ok", type: "tool_result"}]}, type: "user"}),
    []
  )
})

test("renders a successful result with turns, cost, and duration", () => {
  assert.deepEqual(
    renderClaudeEvent({duration_ms: 192000, num_turns: 14, subtype: "success", total_cost_usd: 0.42, type: "result"}),
    ["✓ done (14 turns, $0.42, 3m12s)"]
  )
})

test("renders an error result", () => {
  assert.deepEqual(
    renderClaudeEvent({num_turns: 80, subtype: "error_max_turns", type: "result"}),
    ["✗ error_max_turns (80 turns)"]
  )
})

test("skips unknown event types", () => {
  assert.deepEqual(renderClaudeEvent({type: "stream_event"}), [])
})

test("summarizeToolInput truncates long Bash commands", () => {
  const summary = summarizeToolInput("Bash", {command: `echo ${"x".repeat(200)}`})

  assert.ok(summary.length <= 100)
  assert.ok(summary.endsWith("…"))
})

test("the renderer buffers a JSON line split across chunks and applies the prefix", () => {
  const {lines, stream} = capture()
  const renderer = createClaudeStreamRenderer("[run 1/1] ", [stream])
  const json = JSON.stringify({message: {content: [{input: {command: "ls"}, name: "Bash", type: "tool_use"}]}, type: "assistant"})

  renderer.write(json.slice(0, 12))
  renderer.write(`${json.slice(12)}\n`)

  assert.deepEqual(lines, ["[run 1/1] → Bash: ls\n"])
})

test("the renderer passes through non-JSON lines unchanged", () => {
  const {lines, stream} = capture()
  const renderer = createClaudeStreamRenderer("", [stream])

  renderer.write("not json at all\n")

  assert.deepEqual(lines, ["not json at all\n"])
})

test("flush renders a trailing line that has no newline", () => {
  const {lines, stream} = capture()
  const renderer = createClaudeStreamRenderer("", [stream])

  renderer.write(JSON.stringify({num_turns: 1, subtype: "success", type: "result"}))
  assert.deepEqual(lines, [])

  renderer.flush()
  assert.deepEqual(lines, ["✓ done (1 turns)\n"])
})
