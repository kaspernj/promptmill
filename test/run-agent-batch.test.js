// @ts-check
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {Writable} from "node:stream"
import test from "node:test"
import {fileURLToPath} from "node:url"

import {createClaudeStreamRenderer} from "../src/render-claude-stream.js"
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
  assert.equal(result.stopped, false)

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

test("stops before starting the next run when shouldStop becomes true", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "ignored")
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  let spawned = 0
  const result = await runAgentBatch({
    args: [fixture("echo-stdin.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    onSpawn: () => {spawned += 1},
    promptFile,
    runs: 3,
    shouldStop: () => spawned >= 1, // request a stop once the first run has started
    stderr: captured.stream,
    stdout: captured.stream
  })

  assert.equal(result.stopped, true)
  assert.equal(result.results.length, 1) // only the first run executed; runs 2 and 3 were skipped
  assert.equal(result.runs, 3)
  assert.equal((await fs.readdir(logDir)).length, 1)
})

test("pretty render mode prints readable lines from Claude stream-json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "ignored")
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  await runAgentBatch({
    args: [fixture("stream-json.js")],
    command: process.execPath,
    cwd: root,
    createRenderer: createClaudeStreamRenderer,
    logDir,
    logger: silentLogger,
    promptFile,
    runs: 1,
    stderr: captured.stream,
    stdout: captured.stream
  })

  const output = captured.text()

  assert.match(output, /\[run 1\/1\] · session started \(claude-test\)/)
  assert.match(output, /\[run 1\/1\] → Bash: echo hi/)
  assert.match(output, /\[run 1\/1\] ✓ done \(2 turns, \$0\.01, 2s\)/)
  assert.doesNotMatch(output, /"type":"assistant"/) // raw JSON is rendered away, not printed
})

test("logStderrOnly keeps the child's stderr off the live console but in the log", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const promptFile = path.join(root, "prompt.md")
  await fs.writeFile(promptFile, "ignored")
  const logDir = path.join(root, "logs")
  const out = collectingStream()
  const err = collectingStream()

  const result = await runAgentBatch({
    args: [fixture("stderr-writer.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logStderrOnly: true,
    logger: silentLogger,
    prefixOutputLines: false,
    promptFile,
    runs: 1,
    stderr: err.stream,
    stdout: out.stream
  })

  assert.match(out.text(), /OUT-LINE/)
  assert.doesNotMatch(err.text(), /ERR-LINE/) // suppressed from the live console

  const log = await fs.readFile(result.results[0].logFile, "utf8")

  assert.match(log, /ERR-LINE/) // but still captured in the per-run log
  assert.match(log, /OUT-LINE/)
})

test("captures the agent's session id from the stdout stream and writes it to sessions.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const logDir = path.join(root, "logs")
  const captured = collectingStream()
  const session = {agentName: "codex", capturedId: null, name: "promptmill", uuid: "ignored-by-fake-codex"}

  /** @type {string[][]} */
  const argsPerRun = []
  await runAgentBatch({
    args: (_turns, sessionInfo) => {
      // The factory is called once per run with the current session info; record
      // both calls so we can assert the second run sees the captured id.
      const resumeArgs = sessionInfo?.capturedId ? ["resume", sessionInfo.capturedId] : []
      const argsForRun = [fixture("codex-thread.js"), ...resumeArgs]
      argsPerRun.push(argsForRun)

      return argsForRun
    },
    command: process.execPath,
    cwd: root,
    extractSessionId: (line, _session) => {
      try {
        const event = JSON.parse(line)

        return event?.type === "thread.started" && typeof event.thread_id === "string" ? event.thread_id : null
      } catch {
        return null
      }
    },
    logDir,
    logger: silentLogger,
    promptText: "ignored",
    runs: 2,
    session,
    stderr: captured.stream,
    stdout: captured.stream
  })

  assert.equal(session.capturedId, "FAKE-THREAD-001")

  const persisted = JSON.parse(await fs.readFile(path.join(logDir, "sessions.json"), "utf8"))

  assert.deepEqual(persisted, {"codex:promptmill": "FAKE-THREAD-001"})

  // Run 1 had no captured id yet; run 2 should have been spawned with resume.
  assert.deepEqual(argsPerRun[0].slice(1), [])
  assert.deepEqual(argsPerRun[1].slice(1), ["resume", "FAKE-THREAD-001"])
})

test("persists the session marker when the extractor confirms the session was created, even if the run later exits non-zero", async () => {
  // Regression test for the user-reported bug: a Claude run that hits
  // error_max_turns (exit 1) has already created the session by the time
  // max-turns fires. PR #13's status.code === 0 gate refused to persist; this
  // run uses the extractor directly so a non-zero exit no longer matters.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const logDir = path.join(root, "logs")
  const captured = collectingStream()
  const session = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "preknown-uuid-aaaa"}

  /** @type {(string | null)[]} */
  const observedCapturedIds = []
  const result = await runAgentBatch({
    args: (_turns, sessionInfo) => {
      observedCapturedIds.push(sessionInfo?.capturedId ?? null)

      return [fixture("claude-init-then-fail.js")]
    },
    command: process.execPath,
    cwd: root,
    // Claude-style extractor: returns session.uuid on the system.init line.
    extractSessionId: (line, sess) => {
      try {
        const event = JSON.parse(line)

        return event?.type === "system" && event?.subtype === "init" ? (sess?.uuid ?? null) : null
      } catch { return null }
    },
    logDir,
    logger: silentLogger,
    promptText: "ignored",
    runs: 2,
    session,
    stderr: captured.stream,
    stdout: captured.stream
  })

  // Both runs of the fixture exit 1, but the marker was still written after run 1.
  assert.equal(result.failures, 2)
  assert.equal(session.capturedId, "preknown-uuid-aaaa")

  const persisted = JSON.parse(await fs.readFile(path.join(logDir, "sessions.json"), "utf8"))
  assert.deepEqual(persisted, {"claude:promptmill": "preknown-uuid-aaaa"})

  // Run 1 had no captured id yet; run 2 saw the marker before spawning.
  assert.deepEqual(observedCapturedIds, [null, "preknown-uuid-aaaa"])
})

test("a shared log-dir does not cross-pollinate sessions between agents", async () => {
  // The Claude marker must not be picked up by a later Codex run with the same
  // session name when the user explicitly shares --log-dir.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const logDir = path.join(root, "shared-logs")
  const captured = collectingStream()
  const claudeSession = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "preknown-uuid-claude"}

  await runAgentBatch({
    args: [fixture("claude-init-then-fail.js")],
    command: process.execPath,
    cwd: root,
    extractSessionId: (line, sess) => {
      try {
        const event = JSON.parse(line)

        return event?.type === "system" && event?.subtype === "init" ? (sess?.uuid ?? null) : null
      } catch { return null }
    },
    logDir,
    logger: silentLogger,
    promptText: "ignored",
    runs: 1,
    session: claudeSession,
    stderr: captured.stream,
    stdout: captured.stream
  })

  const persisted = JSON.parse(await fs.readFile(path.join(logDir, "sessions.json"), "utf8"))

  assert.deepEqual(persisted, {"claude:promptmill": "preknown-uuid-claude"})
  // The bare "promptmill" key must not exist — otherwise a later Codex run
  // reading sessions.json from the same dir would mistake the Claude UUID for
  // its own thread id and try `codex exec resume <claude-uuid>`.
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, "promptmill"), false)
})

test("does not persist a session marker when the extractor never fires (e.g. immediate failure before any init event)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const logDir = path.join(root, "logs")
  const captured = collectingStream()
  const session = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "preknown-uuid-bbbb"}

  await runAgentBatch({
    args: [fixture("exit-nonzero.js")],
    command: process.execPath,
    cwd: root,
    extractSessionId: (line, sess) => {
      try {
        const event = JSON.parse(line)

        return event?.type === "system" && event?.subtype === "init" ? (sess?.uuid ?? null) : null
      } catch { return null }
    },
    logDir,
    logger: silentLogger,
    promptText: "ignored",
    runs: 1,
    session,
    stderr: captured.stream,
    stdout: captured.stream
  })

  // The fixture emits no JSON before exiting, so the extractor never returns
  // an id — no marker is written and capturedId stays null.
  assert.equal(session.capturedId, null)
  await assert.rejects(fs.access(path.join(logDir, "sessions.json")))
})

test("promptText is used in place of reading from promptFile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promptmill-"))
  const logDir = path.join(root, "logs")
  const captured = collectingStream()

  const result = await runAgentBatch({
    args: [fixture("echo-stdin.js")],
    command: process.execPath,
    cwd: root,
    logDir,
    logger: silentLogger,
    promptText: "INLINE-PROMPT-CONTENT-9876",
    runs: 1,
    stderr: captured.stream,
    stdout: captured.stream
  })

  assert.equal(result.failures, 0)
  assert.match(captured.text(), /INLINE-PROMPT-CONTENT-9876/)
})

test("runAgentBatch errors when neither promptFile nor promptText is supplied", async () => {
  await assert.rejects(
    runAgentBatch({
      args: [fixture("echo-stdin.js")],
      command: process.execPath,
      logger: silentLogger,
      runs: 1
    }),
    /promptFile or promptText/
  )
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
