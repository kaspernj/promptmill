// @ts-check
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {deriveSessionUuid, readSessionMapping, writeSessionMapping} from "../src/session.js"

test("deriveSessionUuid is deterministic for the same name", () => {
  assert.equal(deriveSessionUuid("promptmill"), deriveSessionUuid("promptmill"))
})

test("deriveSessionUuid produces different UUIDs for different names", () => {
  assert.notEqual(deriveSessionUuid("promptmill"), deriveSessionUuid("project-a"))
})

test("deriveSessionUuid returns a valid v5 UUID with the RFC 4122 variant", () => {
  const uuid = deriveSessionUuid("promptmill")

  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test("readSessionMapping returns an empty object when the file is missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-session-"))

  assert.deepEqual(readSessionMapping(dir), {})
})

test("writeSessionMapping persists and readSessionMapping reads it back", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-session-"))

  writeSessionMapping(dir, {promptmill: "captured-123", "project-a": "captured-456"})

  assert.deepEqual(readSessionMapping(dir), {promptmill: "captured-123", "project-a": "captured-456"})
})

test("readSessionMapping returns an empty object when the file is malformed JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-session-"))

  await fs.writeFile(path.join(dir, "sessions.json"), "{not valid json")

  assert.deepEqual(readSessionMapping(dir), {})
})

test("readSessionMapping drops non-string values defensively", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-session-"))

  await fs.writeFile(path.join(dir, "sessions.json"), JSON.stringify({ok: "yes", bad: 7, alsoBad: null}))

  assert.deepEqual(readSessionMapping(dir), {ok: "yes"})
})

test("writeSessionMapping creates the log directory if it does not exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-session-"))
  const dir = path.join(root, "nested", "log-dir")

  writeSessionMapping(dir, {promptmill: "captured-789"})

  assert.deepEqual(readSessionMapping(dir), {promptmill: "captured-789"})
})
