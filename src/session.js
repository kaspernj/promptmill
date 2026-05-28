// @ts-check
import {createHash} from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Fixed UUID namespace used to derive per-name UUID v5 session ids for agents
 * (Claude, Gemini) that require their `--session-id` argument to be a valid
 * UUID. Hard-coded so the same name always derives the same UUID across machines
 * and time. Do not change — that would break continuity of every existing
 * promptmill-named session.
 */
const PROMPTMILL_NAMESPACE = "f8e9d2c1-7b4a-4d56-9e3c-1a2b3c4d5e6f"

const SESSION_MAPPING_FILENAME = "sessions.json"

/**
 * Parses a UUID string into its 16 raw bytes.
 * @param {string} uuid - Canonical UUID string.
 * @returns {Buffer} - The 16 raw bytes.
 */
function uuidStringToBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex")
}

/**
 * Formats 16 raw bytes as a canonical UUID string (lowercase, hyphenated).
 * @param {Buffer} bytes - Exactly 16 bytes.
 * @returns {string} - The canonical UUID string.
 */
function uuidBytesToString(bytes) {
  const hex = bytes.toString("hex")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Derives a deterministic UUID v5 from a session name under the promptmill
 * namespace. Same name always yields the same UUID, so Claude/Gemini resume
 * the same agent-side session on every run and every invocation.
 * @param {string} name - User-facing session name.
 * @returns {string} - The derived UUID v5 (lowercase).
 */
export function deriveSessionUuid(name) {
  const namespaceBytes = uuidStringToBytes(PROMPTMILL_NAMESPACE)
  const hash = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest()
  const bytes = hash.subarray(0, 16)

  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant

  return uuidBytesToString(bytes)
}

/**
 * @typedef {Record<string, string>} SessionMapping
 */

/**
 * Reads the session-name → captured-agent-id mapping from a log directory.
 * Returns an empty object when the file is missing or malformed.
 * @param {string} logDir - Resolved log directory path.
 * @returns {SessionMapping} - The current mapping (or `{}`).
 */
export function readSessionMapping(logDir) {
  const filePath = path.join(logDir, SESSION_MAPPING_FILENAME)

  if (!fs.existsSync(filePath)) return {}

  const raw = fs.readFileSync(filePath, "utf8")

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON (manual edit, truncated write) is treated like a missing
    // file so the run isn't blocked. Next successful capture overwrites it.
    return {}
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}

  /** @type {SessionMapping} */
  const out = {}

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value
  }

  return out
}

/**
 * Writes the session-name → captured-agent-id mapping atomically (write tmp,
 * then rename) so a concurrent reader never sees a half-written file. Ensures
 * `logDir` exists.
 * @param {string} logDir - Resolved log directory path.
 * @param {SessionMapping} mapping - The mapping to persist.
 * @returns {void}
 */
export function writeSessionMapping(logDir, mapping) {
  fs.mkdirSync(logDir, {recursive: true})

  const filePath = path.join(logDir, SESSION_MAPPING_FILENAME)
  const tmpPath = `${filePath}.tmp`

  fs.writeFileSync(tmpPath, `${JSON.stringify(mapping, null, 2)}\n`)
  fs.renameSync(tmpPath, filePath)
}
