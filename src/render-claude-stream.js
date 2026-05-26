// @ts-check
import {formatDuration, truncate} from "./helpers.js"

/**
 * @typedef {object} ClaudeToolInput
 * @property {string} [command] - Shell command (Bash).
 * @property {string} [description] - Short human description of the tool call.
 * @property {string} [file_path] - Target file (Read/Edit/Write/NotebookEdit).
 * @property {string} [pattern] - Search pattern (Glob/Grep).
 * @property {string} [path] - Search path (Glob/Grep).
 * @property {string} [url] - Fetch target (WebFetch).
 * @property {string} [subagent_type] - Agent type (Task).
 */

/**
 * @typedef {object} ClaudeContentBlock
 * @property {string} [type] - Block kind: "text", "tool_use", "tool_result", "thinking".
 * @property {string} [text] - Text payload (text blocks).
 * @property {string} [name] - Tool name (tool_use blocks).
 * @property {ClaudeToolInput} [input] - Tool input (tool_use blocks).
 * @property {boolean} [is_error] - Whether a tool_result is an error.
 * @property {string | ClaudeContentBlock[]} [content] - Tool result payload (tool_result blocks).
 */

/**
 * @typedef {object} ClaudeMessage
 * @property {ClaudeContentBlock[]} [content] - Message content blocks.
 */

/**
 * @typedef {object} ClaudeStreamEvent
 * @property {string} [type] - Event type: "system", "assistant", "user", "result".
 * @property {string} [subtype] - Event subtype (e.g. "init", "success", "error_max_turns").
 * @property {string} [model] - Model id (system/init events).
 * @property {ClaudeMessage} [message] - Message payload (assistant/user events).
 * @property {boolean} [is_error] - Whether a result event is an error.
 * @property {number} [num_turns] - Agent turns taken (result events).
 * @property {number} [duration_ms] - Wall-clock duration (result events).
 * @property {number} [total_cost_usd] - Run cost in USD (result events).
 * @property {string} [result] - Final result text (result events).
 */

/**
 * @typedef {object} StreamRenderer
 * @property {(chunk: Buffer | string) => void} write - Buffers a chunk and renders any completed NDJSON lines.
 * @property {() => void} flush - Renders any buffered trailing line.
 */

/**
 * Summarizes a tool_use input into a short, human-readable target.
 * @param {string} name - Tool name.
 * @param {ClaudeToolInput} [input] - Tool input object.
 * @returns {string} - A concise summary of what the tool acts on.
 */
export function summarizeToolInput(name, input) {
  if (!input) return ""

  if (name === "Bash") return truncate(input.command || input.description || "", 100)
  if (name === "Read" || name === "Edit" || name === "Write" || name === "NotebookEdit") return input.file_path || ""
  if (name === "Glob" || name === "Grep") return [input.pattern, input.path].filter(Boolean).join(" in ")
  if (name === "Task") return input.description || input.subagent_type || ""
  if (name === "WebFetch") return input.url || ""

  return input.description || ""
}

/**
 * Extracts a single-line preview of a tool_result's content.
 * @param {string | ClaudeContentBlock[] | undefined} content - The tool_result content.
 * @returns {string} - First line of the result text.
 */
function toolResultText(content) {
  if (typeof content === "string") return truncate(content, 120)
  if (!Array.isArray(content)) return ""

  const text = content.map((block) => block.text || "").join(" ").trim()

  return truncate(text, 120)
}

/**
 * Renders one Claude stream-json event into zero or more readable lines.
 * @param {ClaudeStreamEvent} event - A parsed stream-json event.
 * @returns {string[]} - Readable lines (possibly empty for skipped events).
 */
export function renderClaudeEvent(event) {
  if (event.type === "system") {
    return event.subtype === "init" ? [`· session started (${event.model || "unknown model"})`] : []
  }

  if (event.type === "assistant") {
    const lines = []

    for (const block of event.message?.content || []) {
      if (block.type === "text") {
        const text = (block.text || "").trim()

        if (text) lines.push(text)
      } else if (block.type === "tool_use") {
        lines.push(`→ ${block.name || "tool"}: ${summarizeToolInput(block.name || "", block.input)}`.trimEnd())
      }
    }

    return lines
  }

  if (event.type === "user") {
    const lines = []

    for (const block of event.message?.content || []) {
      if (block.type === "tool_result" && block.is_error) {
        lines.push(`  ✗ ${toolResultText(block.content)}`.trimEnd())
      }
    }

    return lines
  }

  if (event.type === "result") {
    const turns = event.num_turns ?? 0

    if (event.is_error || (event.subtype && event.subtype !== "success")) {
      return [`✗ ${event.subtype || "error"} (${turns} turns)`]
    }

    const cost = typeof event.total_cost_usd === "number" ? `, $${event.total_cost_usd.toFixed(2)}` : ""
    const duration = typeof event.duration_ms === "number" ? `, ${formatDuration(event.duration_ms)}` : ""

    return [`✓ done (${turns} turns${cost}${duration})`]
  }

  return []
}

/**
 * Creates a writer that consumes raw Claude stream-json (NDJSON) chunks and
 * writes rendered, prefixed, human-readable lines to every sink. Input is
 * line-buffered; lines that are not valid JSON are passed through unchanged so
 * nothing is hidden. Mirrors the {@link import("./run-agent-process.js")}
 * line-prefixer interface so it can stand in for it.
 * @param {string} prefix - Text prepended to each rendered line.
 * @param {import("node:stream").Writable[]} sinks - Destinations for rendered lines.
 * @returns {StreamRenderer} - The stream-rendering writer.
 */
export function createClaudeStreamRenderer(prefix, sinks) {
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

    /** @type {ClaudeStreamEvent} */
    let event

    try {
      event = /** @type {ClaudeStreamEvent} */ (JSON.parse(line))
    } catch {
      emit(line) // Not JSON (e.g. a non-claude command or a stderr-style line) — pass through.

      return
    }

    for (const rendered of renderClaudeEvent(event)) {
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
