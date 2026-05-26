// @ts-check
import {truncate} from "./helpers.js"

/**
 * @typedef {object} CodexUsage
 * @property {number} [input_tokens] - Input tokens used in the turn.
 * @property {number} [output_tokens] - Output tokens used in the turn.
 * @property {number} [cached_input_tokens] - Cached input tokens.
 * @property {number} [reasoning_output_tokens] - Reasoning output tokens.
 */

/**
 * @typedef {object} CodexFileChange
 * @property {string} [path] - Changed file path.
 * @property {string} [kind] - Change kind: "add" | "delete" | "update".
 */

/**
 * @typedef {object} CodexErrorDetail
 * @property {string} [message] - Error message.
 */

/**
 * @typedef {object} CodexThreadItem
 * @property {string} [id] - Item id.
 * @property {string} [type] - Item kind (agent_message, command_execution, file_change, …).
 * @property {string} [text] - Text (agent_message / reasoning).
 * @property {string} [command] - Shell command (command_execution).
 * @property {number} [exit_code] - Exit code (command_execution).
 * @property {string} [status] - Item status (in_progress | completed | failed | declined).
 * @property {CodexFileChange[]} [changes] - File changes (file_change).
 * @property {string} [server] - MCP server (mcp_tool_call).
 * @property {string} [tool] - MCP tool (mcp_tool_call).
 * @property {string} [query] - Search query (web_search).
 * @property {string} [message] - Message (error item).
 * @property {CodexErrorDetail} [error] - Error details (mcp_tool_call).
 */

/**
 * @typedef {object} CodexThreadEvent
 * @property {string} [type] - "thread.started" | "turn.started" | "turn.completed" | "turn.failed" | "item.started" | "item.updated" | "item.completed" | "error".
 * @property {string} [thread_id] - Thread id (thread.started).
 * @property {CodexUsage} [usage] - Token usage (turn.completed).
 * @property {CodexErrorDetail} [error] - Error details (turn.failed).
 * @property {string} [message] - Message (top-level error event).
 * @property {CodexThreadItem} [item] - The thread item (item.* events).
 */

/**
 * @typedef {object} StreamRenderer
 * @property {(chunk: Buffer | string) => void} write - Buffers a chunk and renders any completed NDJSON lines.
 * @property {() => void} flush - Renders any buffered trailing line.
 */

/**
 * Renders a Codex `item.started` / `item.completed` event into readable lines.
 * @param {string} eventType - "item.started" or "item.completed".
 * @param {CodexThreadItem} [item] - The thread item.
 * @returns {string[]} - Readable lines (possibly empty).
 */
function renderCodexItem(eventType, item) {
  if (!item) return []

  const started = eventType === "item.started"
  const completed = eventType === "item.completed"

  if (item.type === "command_execution") {
    if (started) return [`→ ${truncate(item.command || "", 100)}`]
    if (completed && item.status === "failed") return [`  ✗ exit ${item.exit_code ?? "?"}`]

    return []
  }

  if (item.type === "agent_message") {
    if (!completed || !item.text) return []

    return item.text.trim().split("\n").filter((line) => line.trim() !== "")
  }

  if (item.type === "file_change") {
    if (!completed) return []

    const changes = (item.changes || []).map((change) => `${change.path} (${change.kind})`).join(", ")

    return [`✎ ${truncate(changes, 160)}`]
  }

  if (item.type === "web_search") {
    return started ? [`→ web search: ${truncate(item.query || "", 100)}`] : []
  }

  if (item.type === "mcp_tool_call") {
    if (started) return [`→ ${item.server || "mcp"}.${item.tool || "tool"}`]
    if (completed && item.status === "failed") return [`  ✗ ${truncate(item.error?.message || "mcp tool failed", 120)}`]

    return []
  }

  if (item.type === "error") {
    return completed ? [`  ✗ ${truncate(item.message || "", 200)}`] : []
  }

  return [] // reasoning, todo_list, collab_tool_call, item.updated → skipped
}

/**
 * Renders one Codex `exec --json` ThreadEvent into zero or more readable lines.
 * @param {CodexThreadEvent} event - A parsed ThreadEvent.
 * @returns {string[]} - Readable lines (possibly empty for skipped events).
 */
export function renderCodexEvent(event) {
  if (event.type === "thread.started") return ["· session started"]

  if (event.type === "turn.completed") {
    const usage = event.usage
    const parts = []

    if (usage && typeof usage.output_tokens === "number") parts.push(`${usage.output_tokens} output`)
    if (usage && typeof usage.input_tokens === "number") parts.push(`${usage.input_tokens} input`)

    return [parts.length > 0 ? `✓ done (${parts.join(", ")} tokens)` : "✓ done"]
  }

  if (event.type === "turn.failed") return [`✗ ${event.error?.message || "turn failed"}`]

  if (event.type === "error") return [`  ! ${truncate(event.message || "", 200)}`]

  if (event.type === "item.started" || event.type === "item.completed") return renderCodexItem(event.type, event.item)

  return []
}

/**
 * Creates a writer that consumes raw Codex `exec --json` (NDJSON) chunks and
 * writes rendered, prefixed, readable lines to every sink. Input is
 * line-buffered; lines that are not valid JSON are passed through unchanged.
 * @param {string} prefix - Text prepended to each rendered line.
 * @param {import("node:stream").Writable[]} sinks - Destinations for rendered lines.
 * @returns {StreamRenderer} - The stream-rendering writer.
 */
export function createCodexStreamRenderer(prefix, sinks) {
  let buffer = ""

  /**
   * Writes a rendered string to every sink, prefixing each physical line.
   * @param {string} text - Rendered text (may contain newlines).
   * @returns {void}
   */
  function emit(text) {
    for (const physical of text.split("\n")) {
      for (const sink of sinks) {
        sink.write(`${prefix}${physical}\n`)
      }
    }
  }

  /**
   * Parses and renders one complete NDJSON line.
   * @param {string} line - A single line without its trailing newline.
   * @returns {void}
   */
  function handleLine(line) {
    if (line.trim() === "") return

    /** @type {CodexThreadEvent} */
    let event

    try {
      event = /** @type {CodexThreadEvent} */ (JSON.parse(line))
    } catch {
      emit(line) // Not JSON (e.g. a Codex stderr-style log) — pass through.

      return
    }

    for (const rendered of renderCodexEvent(event)) {
      emit(rendered)
    }
  }

  return {
    write(chunk) {
      buffer += String(chunk)

      let newlineIndex = buffer.indexOf("\n")

      while (newlineIndex !== -1) {
        handleLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf("\n")
      }
    },
    flush() {
      if (buffer.length === 0) return

      handleLine(buffer)
      buffer = ""
    }
  }
}
