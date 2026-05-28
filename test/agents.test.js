// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {AGENT_NAMES, getAgent} from "../src/agents.js"

/**
 * @param {string[]} args - Assembled CLI args.
 * @param {string} flag - Flag whose following value to read.
 * @returns {string | undefined} - The value after the flag.
 */
function valueAfter(args, flag) {
  const index = args.indexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

test("AGENT_NAMES lists the supported agents", () => {
  assert.deepEqual(AGENT_NAMES, ["claude", "gemini", "codex", "antigravity"])
})

test("getAgent throws on an unknown agent", () => {
  assert.throws(() => getAgent("bogus"), /Unknown agent: bogus/)
})

test("the claude agent has Claude defaults", () => {
  const claude = getAgent("claude")

  assert.equal(claude.command, "claude")
  assert.equal(claude.label, "Claude")
  assert.equal(claude.logDir, ".claude-runs")
  assert.equal(claude.logFilePrefix, "claude-run-")
  assert.equal(claude.usesMaxTurns, true)
})

test("claude.buildArgs maps pretty to stream-json with --verbose and includes --max-turns", () => {
  const args = getAgent("claude").buildArgs(80, "pretty", [], null)

  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
  assert.equal(valueAfter(args, "--max-turns"), "80")
})

test("the gemini agent has Gemini defaults", () => {
  const gemini = getAgent("gemini")

  assert.equal(gemini.command, "gemini")
  assert.equal(gemini.label, "Gemini")
  assert.equal(gemini.logDir, ".gemini-runs")
  assert.equal(gemini.logFilePrefix, "gemini-run-")
  assert.equal(gemini.usesMaxTurns, false)
})

test("gemini.buildArgs uses approval-mode yolo and stream-json, without claude-only flags", () => {
  const args = getAgent("gemini").buildArgs(80, "pretty", [], null)

  assert.equal(valueAfter(args, "--approval-mode"), "yolo")
  assert.equal(valueAfter(args, "--output-format"), "stream-json")
  assert.ok(!args.includes("--verbose")) // gemini stream-json does not require it
  assert.ok(!args.includes("--max-turns")) // gemini has no turn-limit CLI flag
  assert.ok(!args.includes("-p")) // prompt is read from stdin
})

test("buildArgs appends passthrough args for both agents", () => {
  assert.deepEqual(getAgent("gemini").buildArgs(80, "text", ["-m", "gemini-2.5-pro"], null).slice(-2), ["-m", "gemini-2.5-pro"])
  assert.deepEqual(getAgent("claude").buildArgs(80, "text", ["--foo"], null).slice(-1), ["--foo"])
})

test("the codex agent has Codex defaults", () => {
  const codex = getAgent("codex")

  assert.equal(codex.command, "codex")
  assert.equal(codex.label, "Codex")
  assert.equal(codex.logDir, ".codex-runs")
  assert.equal(codex.logFilePrefix, "codex-run-")
  assert.equal(codex.usesMaxTurns, false)
  assert.equal(codex.textProgressOnStderr, true)
})

test("only codex declares text-mode progress on stderr", () => {
  assert.notEqual(getAgent("claude").textProgressOnStderr, true)
  assert.notEqual(getAgent("gemini").textProgressOnStderr, true)
})

test("codex.buildArgs runs `exec --json` with sandbox bypass, prompt via trailing stdin -", () => {
  const args = getAgent("codex").buildArgs(80, "pretty", [], null)

  assert.equal(args[0], "exec")
  assert.ok(args.includes("--json"))
  assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"))
  assert.equal(args.at(-1), "-") // prompt read from stdin
  assert.ok(!args.includes("--max-turns"))
})

test("codex text mode omits --json and passthrough lands before the trailing -", () => {
  const text = getAgent("codex").buildArgs(80, "text", [], null)

  assert.ok(!text.includes("--json"))

  const withModel = getAgent("codex").buildArgs(80, "pretty", ["-m", "gpt-5.1-codex"], null)

  assert.deepEqual(withModel.slice(-3), ["-m", "gpt-5.1-codex", "-"]) // passthrough before stdin -
})

test("agents declare their default-highest model and level (and how to render them)", () => {
  const claude = getAgent("claude")
  assert.equal(claude.defaultModel, "opus")
  assert.equal(claude.defaultLevel, "xhigh")
  assert.deepEqual(claude.modelArg?.("opus"), ["--model", "opus"])
  assert.deepEqual(claude.levelArg?.("xhigh"), ["--effort", "xhigh"])

  const gemini = getAgent("gemini")
  assert.equal(gemini.defaultModel, "pro")
  assert.deepEqual(gemini.modelArg?.("pro"), ["-m", "pro"])
  assert.equal(gemini.levelArg, undefined) // Gemini has no separate level
  assert.equal(gemini.defaultLevel, undefined)

  const codex = getAgent("codex")
  assert.equal(codex.defaultModel, "gpt-5.5")
  assert.equal(codex.defaultLevel, "xhigh")
  assert.deepEqual(codex.modelArg?.("gpt-5.5"), ["-m", "gpt-5.5"])
  assert.deepEqual(codex.levelArg?.("xhigh"), ["-c", 'model_reasoning_effort="xhigh"'])

  const antigravity = getAgent("antigravity")
  assert.equal(antigravity.modelArg, undefined) // agy has no model/level flag
  assert.equal(antigravity.levelArg, undefined)
  assert.equal(antigravity.defaultModel, undefined)
})

test("the antigravity agent has Antigravity defaults and no renderer", () => {
  const antigravity = getAgent("antigravity")

  assert.equal(antigravity.command, "agy")
  assert.equal(antigravity.label, "Antigravity")
  assert.equal(antigravity.logDir, ".antigravity-runs")
  assert.equal(antigravity.logFilePrefix, "antigravity-run-")
  assert.equal(antigravity.usesMaxTurns, false)
  assert.equal(antigravity.createRenderer, undefined) // text-only; no event stream to render
})

test("antigravity.buildArgs runs `agy --print` with auto-approve regardless of output mode", () => {
  const args = getAgent("antigravity").buildArgs(80, "pretty", [], null)

  assert.ok(args.includes("--print"))
  assert.ok(args.includes("--dangerously-skip-permissions"))
  assert.ok(!args.includes("--max-turns"))
  // The output mode does not change agy's args (it has no JSON/output-format).
  assert.deepEqual(getAgent("antigravity").buildArgs(80, "text", [], null), args)
})

test("claude.buildArgs pins the session via --session-id <uuid> when session is given", () => {
  const session = {capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}
  const args = getAgent("claude").buildArgs(80, "pretty", [], session)

  assert.equal(valueAfter(args, "--session-id"), session.uuid)
})

test("gemini.buildArgs pins the session via --session-id <uuid> when session is given", () => {
  const session = {capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}
  const args = getAgent("gemini").buildArgs(80, "pretty", [], session)

  assert.equal(valueAfter(args, "--session-id"), session.uuid)
})

test("codex.buildArgs omits `resume` when capturedId is null and inserts it after exec when known", () => {
  const fresh = {capturedId: null, name: "promptmill", uuid: "ignored-for-codex"}
  const freshArgs = getAgent("codex").buildArgs(80, "pretty", [], fresh)

  assert.equal(freshArgs[0], "exec")
  assert.notEqual(freshArgs[1], "resume")

  const resumed = {capturedId: "01ABCDEF-1234-5678-90AB-CDEF12345678", name: "promptmill", uuid: "ignored"}
  const resumedArgs = getAgent("codex").buildArgs(80, "pretty", [], resumed)

  assert.deepEqual(resumedArgs.slice(0, 3), ["exec", "resume", resumed.capturedId])
})

test("antigravity.buildArgs pins --conversation only when capturedId is known", () => {
  const fresh = {capturedId: null, name: "promptmill", uuid: "ignored"}

  assert.ok(!getAgent("antigravity").buildArgs(80, "pretty", [], fresh).includes("--conversation"))

  const resumed = {capturedId: "conv-abc123", name: "promptmill", uuid: "ignored"}
  const resumedArgs = getAgent("antigravity").buildArgs(80, "pretty", [], resumed)

  assert.equal(valueAfter(resumedArgs, "--conversation"), "conv-abc123")
})

test("codex.buildArgs forces --json in text mode when a session id still needs capturing", () => {
  const session = {capturedId: null, name: "promptmill", uuid: "ignored"}
  const args = getAgent("codex").buildArgs(80, "text", [], session)

  // Without --json the extractor would never see thread.started; force it on
  // for the first capture run even though the user picked text mode.
  assert.ok(args.includes("--json"))
})

test("codex.buildArgs honors text mode once the session id is captured", () => {
  const session = {capturedId: "FAKE-THREAD", name: "promptmill", uuid: "ignored"}
  const args = getAgent("codex").buildArgs(80, "text", [], session)

  // Already captured — no reason to override the user's chosen format.
  assert.ok(!args.includes("--json"))
})

test("codex.extractSessionId parses thread.started events and ignores other JSON", () => {
  const codex = getAgent("codex")

  assert.equal(codex.extractSessionId?.('{"type":"thread.started","thread_id":"01J3X…"}'), "01J3X…")
  assert.equal(codex.extractSessionId?.('{"type":"turn.completed"}'), null)
  assert.equal(codex.extractSessionId?.("not json"), null)
})
