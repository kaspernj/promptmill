// @ts-check
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {Writable} from "node:stream"
import test from "node:test"
import {fileURLToPath} from "node:url"

import {runAgentBatch} from "../src/run-agent-batch.js"

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")

/** @returns {{stream: Writable, text: () => string}} - A writable that captures everything written to it. */
function collectingStream() {
  /** @type {Buffer[]} */
  const chunks = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    }
  })

  return {stream, text: () => Buffer.concat(chunks).toString("utf8")}
}

/** @type {{log: (message: string) => void}} */
const silentLogger = {log() {}}

/**
 * @param {string} name - Fixture filename.
 * @returns {string} - Absolute path to the fixture.
 */
function fixture(name) {
  return path.join(fixturesDir, name)
}

test("runs the command N times and writes one prompt-bearing log per run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  const promptText = "PROMPT-MARKER-12345"
  await fs.writeFile(promptFile, promptText)
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  const result = await runAgentBatch({
    args: [fixture("echo-stdin.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    promptFile,
    runs: 2,
    stderr: captured.stream,
    stdout: captured.stream
  })

  assert.equal(result.runs, 2)
  assert.equal(result.failures, 0)

  const logFiles = (await fs.readdir(logDir)).sort()

  assert.equal(logFiles.length, 2)
  assert.match(logFiles[0], /^claude-run-1-\d{8}-\d{6}\.log$/)
  assert.match(logFiles[1], /^claude-run-2-\d{8}-\d{6}\.log$/)

  const firstLog = await fs.readFile(path.join(logDir, logFiles[0]), "utf8")

  assert.match(firstLog, /\[run 1\/2\] PROMPT-MARKER-12345/) // prompt -> child stdin -> prefixed tee -> log file
  assert.match(captured.text(), /\[run 1\/2\] PROMPT-MARKER-12345/) // also tee'd to the live stream
  assert.match(captured.text(), /\[run 2\/2\] PROMPT-MARKER-12345/)
})

test("prefixes every output line with the run indicator, including a trailing partial line", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "ignored")
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  await runAgentBatch({
    args: [fixture("multiline.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    promptFile,
    runs: 1,
    stderr: captured.stream,
    stdout: captured.stream
  })

  const output = captured.text()

  // Two full lines and the trailing partial each get the prefix on their own line.
  assert.match(output, /\[run 1\/1\] alpha\n/)
  assert.match(output, /\[run 1\/1\] beta\n/)
  assert.match(output, /\[run 1\/1\] partial\n/)
})

test("omits the run prefix when prefixOutputLines is false", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "ignored")
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  await runAgentBatch({
    args: [fixture("multiline.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    prefixOutputLines: false,
    promptFile,
    runs: 1,
    stderr: captured.stream,
    stdout: captured.stream
  })

  const output = captured.text()

  assert.match(output, /alpha\nbeta\npartial/)
  assert.doesNotMatch(output, /\[run /)
})

test("continues after a non-zero run and counts failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "hello")
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  const result = await runAgentBatch({
    args: [fixture("exit-nonzero.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    promptFile,
    runs: 3,
    stderr: captured.stream,
    stdout: captured.stream
  })

  assert.equal(result.runs, 3)
  assert.equal(result.failures, 3)
  assert.match(captured.text(), /exited with code 1\. Continuing to next run\./)
})
