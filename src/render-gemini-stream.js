// @ts-check
import {formatDuration, truncate} from "./helpers.js"

/**
 * @typedef {object} GeminiToolParameters
 * @property {string} [command] - Shell command (run_shell_command).
 * @property {string} [file_path] - Target file.
 * @property {string} [absolute_path] - Target file (read_file/write_file).
 * @property {string} [path] - Target path.
 * @property {string} [url] - Fetch target (web_fetch).
 * @property {string} [query] - Search query (google_web_search).
 * @property {string} [pattern] - Glob/grep pattern.
 * @property {string} [prompt] - Prompt passed to a sub-tool.
 */

/**
 * @typedef {object} GeminiToolError
 * @property {string} [type] - Error type.
 * @property {string} [message] - Error message.
 */

/**
 * @typedef {object} GeminiStreamStats
 * @property {number} [total_tokens] - Total tokens used.
 * @property {number} [duration_ms] - Wall-clock duration.
 * @property {number} [tool_calls] - Number of tool calls.
 */

/**
 * @typedef {object} GeminiStreamEvent
 * @property {string} [type] - "init" | "message" | "tool_use" | "tool_result" | "error" | "result".
 * @property {string} [model] - Model id (init).
 * @property {string} [session_id] - Session id (init).
 * @property {string} [role] - "user" | "assistant" (message).
 * @property {string} [content] - Message text (message).
 * @property {boolean} [delta] - Whether the message is a streamed delta.
 * @property {string} [tool_name] - Tool name (tool_use).
 * @property {GeminiToolParameters} [parameters] - Tool parameters (tool_use).
 * @property {string} [status] - "success" | "error" (tool_result/result).
 * @property {string} [output] - Tool output (tool_result).
 * @property {GeminiToolError} [error] - Error details (tool_result/result).
 * @property {string} [severity] - "warning" | "error" (error event).
 * @property {string} [message] - Message (error event).
 * @property {GeminiStreamStats} [stats] - Aggregated stats (result).
 */

/**
 * @typedef {object} StreamRenderer
 * @property {(chunk: Buffer | string) => void} write - Buffers a chunk and renders any completed NDJSON lines.
 * @property {() => void} flush - Renders any buffered trailing line and assistant text.
 */

/**
 * Summarizes a Gemini tool_use's parameters into a short, human-readable
 * target. Gemini tool names/params differ from Claude's and vary by tool, so
 * this tries common keys in priority order, then falls back to a truncated JSON.
 * @param {string} toolName - Tool name (unused today, kept for parity/future).
 * @param {GeminiToolParameters} [parameters] - Tool parameters.
 * @returns {string} - A concise summary of what the tool acts on.
 */
export function summarizeGeminiParams(toolName, parameters) {
  if (!parameters) return ""

  const keys = /** @type {(keyof GeminiToolParameters)[]} */ (["command", "file_path", "absolute_path", "path", "url", "query", "pattern", "prompt"])

  for (const key of keys) {
    const value = parameters[key]

    if (typeof value === "string" && value !== "") return truncate(value, 100)
  }

  const json = JSON.stringify(parameters)

  return json === "{}" ? "" : truncate(json, 100)
}

/**
 * Formats a Gemini `result` event into a one-line summary.
 * @param {GeminiStreamEvent} event - The result event.
 * @returns {string} - The summary line.
 */
export function formatGeminiResult(event) {
  if (event.status === "error") return `✗ ${event.error?.message || event.status || "error"}`

  const stats = event.stats
  const parts = []

  if (stats && typeof stats.tool_calls === "number") parts.push(`${stats.tool_calls} tool calls`)
  if (stats && typeof stats.total_tokens === "number") parts.push(`${stats.total_tokens} tokens`)
  if (stats && typeof stats.duration_ms === "number") parts.push(formatDuration(stats.duration_ms))

  return parts.length > 0 ? `✓ done (${parts.join(", ")})` : "✓ done"
}

/**
 * Creates a writer that consumes raw Gemini stream-json (NDJSON) chunks and
 * writes rendered, prefixed, readable lines to every sink. Input is
 * line-buffered; lines that are not valid JSON are passed through unchanged.
 * Assistant `message` events may arrive as `delta` chunks, so their text is
 * accumulated and emitted line-by-line, flushed before any non-message event.
 * @param {string} prefix - Text prepended to each rendered line.
 * @param {import("node:stream").Writable[]} sinks - Destinations for rendered lines.
 * @returns {StreamRenderer} - The stream-rendering writer.
 */
export function createGeminiStreamRenderer(prefix, sinks) {
  let lineBuffer = ""
  let assistantBuffer = ""

  /**
   * Writes one rendered line (prefixed) to every sink.
   * @param {string} text - The line text (no trailing newline).
   * @returns {void}
   */
  function writeLine(text) {
    for (const sink of sinks) {
      sink.write(`${prefix}${text}\n`)
    }
  }

  /**
   * Emits any complete lines buffered from assistant deltas, keeping a partial.
   * @returns {void}
   */
  function drainAssistant() {
    let newlineIndex = assistantBuffer.indexOf("\n")

    while (newlineIndex !== -1) {
      const line = assistantBuffer.slice(0, newlineIndex)

      if (line.trim() !== "") writeLine(line)

      assistantBuffer = assistantBuffer.slice(newlineIndex + 1)
      newlineIndex = assistantBuffer.indexOf("\n")
    }
  }

  /**
   * Flushes complete and trailing assistant text as lines.
   * @returns {void}
   */
  function flushAssistant() {
    drainAssistant()

    if (assistantBuffer.trim() !== "") writeLine(assistantBuffer.trim())

    assistantBuffer = ""
  }

  /**
   * Renders a single parsed Gemini event.
   * @param {GeminiStreamEvent} event - The parsed event.
   * @returns {void}
   */
  function handleEvent(event) {
    if (event.type === "message") {
      if (event.role === "assistant" && typeof event.content === "string") {
        assistantBuffer += event.content
        drainAssistant()
      }

      return
    }

    flushAssistant() // any non-message event ends the current assistant turn

    if (event.type === "init") {
      writeLine(`· session started (${event.model || "unknown model"})`)
    } else if (event.type === "tool_use") {
      writeLine(`→ ${event.tool_name || "tool"}: ${summarizeGeminiParams(event.tool_name || "", event.parameters)}`.trimEnd())
    } else if (event.type === "tool_result" && event.status === "error") {
      writeLine(`  ✗ ${truncate(event.output || event.error?.message || "", 120)}`.trimEnd())
    } else if (event.type === "error") {
      writeLine(`  ! ${truncate(event.message || "", 200)}`.trimEnd())
    } else if (event.type === "result") {
      writeLine(formatGeminiResult(event))
    }
  }

  /**
   * Parses and renders one complete NDJSON line.
   * @param {string} line - A single line without its trailing newline.
   * @returns {void}
   */
  function handleLine(line) {
    if (line.trim() === "") return

    /** @type {GeminiStreamEvent} */
    let event

    try {
      event = /** @type {GeminiStreamEvent} */ (JSON.parse(line))
    } catch {
      writeLine(line) // Not JSON — pass through unchanged.

      return
    }

    handleEvent(event)
  }

  return {
    write(chunk) {
      lineBuffer += String(chunk)

      let newlineIndex = lineBuffer.indexOf("\n")

      while (newlineIndex !== -1) {
        handleLine(lineBuffer.slice(0, newlineIndex))
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        newlineIndex = lineBuffer.indexOf("\n")
      }
    },
    flush() {
      if (lineBuffer.length > 0) {
        handleLine(lineBuffer)
        lineBuffer = ""
      }

      flushAssistant()
    }
  }
}
