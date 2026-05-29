// @ts-check

/**
 * @param {number} value - Number to zero-pad.
 * @returns {string} - Two-digit zero-padded string.
 */
function padDatePart(value) {
  return String(value).padStart(2, "0")
}

/**
 * Formats a date as a filesystem-safe timestamp: `YYYYMMDD-HHMMSS`.
 * @param {Date} [date] - Date to format (defaults to now).
 * @returns {string} - The formatted timestamp.
 */
export function timestampForLogFile(date = new Date()) {
  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hours = padDatePart(date.getHours())
  const minutes = padDatePart(date.getMinutes())
  const seconds = padDatePart(date.getSeconds())

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

/**
 * Parses an integer option from a raw value, falling back when empty and
 * throwing a descriptive error when the value is not an integer at least
 * `minimum`.
 * @template {number | null} F
 * @param {string | undefined | null} rawValue - Raw value (flag or env var).
 * @param {object} args - Options.
 * @param {string} args.name - Option name used in error messages.
 * @param {F} args.fallback - Value returned when `rawValue` is empty.
 * @param {number} args.minimum - Minimum allowed value (inclusive).
 * @returns {number | F} - The parsed integer, or the fallback.
 */
export function integerOption(rawValue, {name, fallback, minimum}) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallback
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`)
  }

  const parsed = Number.parseInt(rawValue, 10)

  if (parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`)
  }

  return parsed
}

/**
 * Truncates text to the first line and a maximum length, appending an ellipsis
 * when cut. Used by the stream renderers to keep tool/result lines concise.
 * @param {string} text - The text to truncate.
 * @param {number} max - Maximum length before truncation.
 * @returns {string} - The truncated (or original) first line.
 */
export function truncate(text, max) {
  const firstLine = text.split("\n")[0]

  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine
}

/**
 * Formats a millisecond duration as a compact `MmSs` / `Ss` string.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} - Compact duration label.
 */
export function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`
}

/**
 * Builds a per-run log filename (without directory).
 * @param {object} args - Options.
 * @param {string} args.logFilePrefix - Filename prefix.
 * @param {number} args.runNumber - 1-based run index.
 * @param {string} args.timestamp - Timestamp from {@link timestampForLogFile}.
 * @returns {string} - The log filename.
 */
export function buildLogFileName({logFilePrefix, runNumber, timestamp}) {
  return `${logFilePrefix}${runNumber}-${timestamp}.log`
}
