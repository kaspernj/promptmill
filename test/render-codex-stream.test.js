// @ts-check
import assert from "node:assert/strict"
import {Writable} from "node:stream"
import test from "node:test"

import {createCodexStreamRenderer, renderCodexEvent} from "../src/render-codex-stream.js"

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
 * @param {object[]} events - Codex ThreadEvents.
 * @returns {string} - Newline-delimited JSON.
 */
function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}

test("renderCodexEvent maps thread/turn events", () => {
  assert.deepEqual(renderCodexEvent({thread_id: "t1", type: "thread.started"}), ["· session started"])
  assert.deepEqual(
    renderCodexEvent({type: "turn.completed", usage: {input_tokens: 100, output_tokens: 5}}),
    ["✓ done (5 output, 100 input tokens)"]
  )
  assert.deepEqual(renderCodexEvent({error: {message: "boom"}, type: "turn.failed"}), ["✗ boom"])
  assert.deepEqual(renderCodexEvent({message: "heads up", type: "error"}), ["  ! heads up"])
})

test("renderCodexEvent maps command_execution items", () => {
  assert.deepEqual(
    renderCodexEvent({item: {command: "npm test", id: "i1", status: "in_progress", type: "command_execution"}, type: "item.started"}),
    ["→ npm test"]
  )
  assert.deepEqual(
    renderCodexEvent({item: {command: "npm test", exit_code: 1, id: "i1", status: "failed", type: "command_execution"}, type: "item.completed"}),
    ["  ✗ exit 1"]
  )
  // A successful command's completion is not re-rendered (it was shown on start).
  assert.deepEqual(
    renderCodexEvent({item: {command: "npm test", exit_code: 0, id: "i1", status: "completed", type: "command_execution"}, type: "item.completed"}),
    []
  )
})

test("renderCodexEvent maps agent_message, file_change, web_search, mcp items", () => {
  assert.deepEqual(
    renderCodexEvent({item: {id: "i2", text: "Implemented the fix.\nVerified.", type: "agent_message"}, type: "item.completed"}),
    ["Implemented the fix.", "Verified."]
  )
  assert.deepEqual(
    renderCodexEvent({item: {changes: [{kind: "update", path: "a.js"}, {kind: "add", path: "b.js"}], id: "i3", status: "completed", type: "file_change"}, type: "item.completed"}),
    ["✎ a.js (update), b.js (add)"]
  )
  assert.deepEqual(
    renderCodexEvent({item: {id: "i4", query: "promptmill", type: "web_search"}, type: "item.started"}),
    ["→ web search: promptmill"]
  )
  assert.deepEqual(
    renderCodexEvent({item: {id: "i5", server: "github", status: "in_progress", tool: "create_pr", type: "mcp_tool_call"}, type: "item.started"}),
    ["→ github.create_pr"]
  )
})

test("renderCodexEvent skips reasoning and item.updated", () => {
  assert.deepEqual(renderCodexEvent({item: {id: "i6", text: "thinking…", type: "reasoning"}, type: "item.completed"}), [])
  assert.deepEqual(renderCodexEvent({item: {id: "i2", text: "partial", type: "agent_message"}, type: "item.updated"}), [])
})

test("the renderer renders a real-shaped sequence with the run prefix", () => {
  const {lines, stream} = capture()
  const renderer = createCodexStreamRenderer("[run 1/1] ", [stream])

  renderer.write(jsonl([
    {thread_id: "019e", type: "thread.started"},
    {type: "turn.started"},
    {item: {command: "git status", id: "i1", status: "in_progress", type: "command_execution"}, type: "item.started"},
    {item: {id: "i2", text: "hi", type: "agent_message"}, type: "item.completed"},
    {type: "turn.completed", usage: {cached_input_tokens: 22400, input_tokens: 27589, output_tokens: 5}}
  ]))
  renderer.flush()

  const output = lines.join("")

  assert.match(output, /\[run 1\/1\] · session started/)
  assert.match(output, /\[run 1\/1\] → git status/)
  assert.match(output, /\[run 1\/1\] hi/)
  assert.match(output, /\[run 1\/1\] ✓ done \(5 output, 27589 input tokens\)/)
})

test("the renderer buffers split JSON and passes non-JSON through", () => {
  const {lines, stream} = capture()
  const renderer = createCodexStreamRenderer("", [stream])
  const event = JSON.stringify({thread_id: "x", type: "thread.started"})

  renderer.write(event.slice(0, 10))
  renderer.write(`${event.slice(10)}\n`)
  renderer.write("ERROR codex_core: shell snapshot failed\n") // stderr-style non-JSON

  assert.deepEqual(lines, ["· session started\n", "ERROR codex_core: shell snapshot failed\n"])
})
