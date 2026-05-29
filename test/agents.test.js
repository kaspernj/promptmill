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

test("claude.buildArgs uses --session-id <uuid> on the first run (capturedId null) and --resume after", () => {
  const fresh = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}
  const freshArgs = getAgent("claude").buildArgs(80, "pretty", [], fresh)

  assert.equal(valueAfter(freshArgs, "--session-id"), fresh.uuid)
  assert.ok(!freshArgs.includes("--resume"))

  const resumed = {agentName: "claude", capturedId: fresh.uuid, name: "promptmill", uuid: fresh.uuid}
  const resumedArgs = getAgent("claude").buildArgs(80, "pretty", [], resumed)

  assert.equal(valueAfter(resumedArgs, "--resume"), resumed.uuid)
  assert.ok(!resumedArgs.includes("--session-id"))
})

test("gemini.buildArgs uses --session-id <uuid> on the first run (capturedId null) and --resume after", () => {
  const fresh = {agentName: "gemini", capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}
  const freshArgs = getAgent("gemini").buildArgs(80, "pretty", [], fresh)

  assert.equal(valueAfter(freshArgs, "--session-id"), fresh.uuid)
  assert.ok(!freshArgs.includes("--resume"))

  const resumed = {agentName: "gemini", capturedId: fresh.uuid, name: "promptmill", uuid: fresh.uuid}
  const resumedArgs = getAgent("gemini").buildArgs(80, "pretty", [], resumed)

  assert.equal(valueAfter(resumedArgs, "--resume"), resumed.uuid)
  assert.ok(!resumedArgs.includes("--session-id"))
})

test("claude.extractSessionId returns session.uuid on the system.init event and null otherwise", () => {
  const claude = getAgent("claude")
  const session = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}

  assert.equal(claude.extractSessionId?.('{"type":"system","subtype":"init","model":"claude-opus-4-7"}', session), session.uuid)
  // Different subtype (or none) means the session start hasn't been confirmed.
  assert.equal(claude.extractSessionId?.('{"type":"system","subtype":"other"}', session), null)
  assert.equal(claude.extractSessionId?.('{"type":"assistant","message":{"content":[]}}', session), null)
  assert.equal(claude.extractSessionId?.("not json", session), null)
  // No session info → we cannot return a UUID even on init.
  assert.equal(claude.extractSessionId?.('{"type":"system","subtype":"init"}', null), null)
})

test("claude.extractSessionId self-heals when Claude rejects --session-id as already in use", () => {
  const claude = getAgent("claude")
  const session = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "11111111-2222-3333-4444-555555555555"}

  // The error tells us the session already exists with our UUID — persist marker.
  assert.equal(
    claude.extractSessionId?.(`Error: Session ID ${session.uuid} is already in use.`, session),
    session.uuid
  )

  // Defensive: a foreign UUID in the error must NOT persist our marker.
  assert.equal(
    claude.extractSessionId?.("Error: Session ID 99999999-9999-9999-9999-999999999999 is already in use.", session),
    null
  )

  // No session means there is no UUID we can validate against.
  assert.equal(
    claude.extractSessionId?.("Error: Session ID 11111111-2222-3333-4444-555555555555 is already in use.", null),
    null
  )
})

test("gemini.extractSessionId returns event.session_id from the init event", () => {
  const gemini = getAgent("gemini")
  const session = {agentName: "gemini", capturedId: null, name: "promptmill", uuid: "ignored"}

  assert.equal(gemini.extractSessionId?.('{"type":"init","session_id":"abc-123","model":"pro"}', session), "abc-123")
  assert.equal(gemini.extractSessionId?.('{"type":"message","content":"hi"}', session), null)
  assert.equal(gemini.extractSessionId?.('{"type":"init"}', session), null) // init without session_id
  assert.equal(gemini.extractSessionId?.("not json", session), null)
})

test("gemini.extractSessionId self-heals when Gemini rejects --session-id as already existing", () => {
  const gemini = getAgent("gemini")
  const session = {agentName: "gemini", capturedId: null, name: "promptmill", uuid: "22222222-3333-4444-5555-666666666666"}

  assert.equal(
    gemini.extractSessionId?.(`Session ID "${session.uuid}" already exists. Use --resume to resume it, or provide a different ID.`, session),
    session.uuid
  )

  // Defensive: foreign UUID is never persisted.
  assert.equal(
    gemini.extractSessionId?.('Session ID "99999999-9999-9999-9999-999999999999" already exists.', session),
    null
  )
})

test("claude.buildArgs forces stream-json for the first capture run when format is text or json", () => {
  const fresh = {agentName: "claude", capturedId: null, name: "promptmill", uuid: "fresh-uuid"}

  for (const nonStreamingFormat of /** @type {("text" | "json")[]} */ (["text", "json"])) {
    const args = getAgent("claude").buildArgs(null, nonStreamingFormat, [], fresh)

    assert.equal(valueAfter(args, "--output-format"), "stream-json", `should force stream-json from ${nonStreamingFormat}`)
    assert.ok(args.includes("--verbose"), `should add --verbose from ${nonStreamingFormat}`)
  }
})

test("claude.buildArgs honors text/json mode once the session id is captured", () => {
  const resumed = {agentName: "claude", capturedId: "uuid", name: "promptmill", uuid: "uuid"}

  for (const userFormat of /** @type {("text" | "json")[]} */ (["text", "json"])) {
    const args = getAgent("claude").buildArgs(null, userFormat, [], resumed)

    assert.equal(valueAfter(args, "--output-format"), userFormat)
    assert.ok(!args.includes("--verbose"))
  }
})

test("gemini.buildArgs forces stream-json for the first capture run when format is text or json", () => {
  const fresh = {agentName: "gemini", capturedId: null, name: "promptmill", uuid: "fresh-uuid"}

  for (const nonStreamingFormat of /** @type {("text" | "json")[]} */ (["text", "json"])) {
    const args = getAgent("gemini").buildArgs(null, nonStreamingFormat, [], fresh)

    assert.equal(valueAfter(args, "--output-format"), "stream-json", `should force stream-json from ${nonStreamingFormat}`)
  }
})

test("claude.buildArgs omits --max-turns when null and emits it when given", () => {
  const noCap = getAgent("claude").buildArgs(null, "pretty", [], null)
  assert.ok(!noCap.includes("--max-turns"))

  const withCap = getAgent("claude").buildArgs(50, "pretty", [], null)
  assert.equal(valueAfter(withCap, "--max-turns"), "50")
})

test("codex.buildArgs omits `resume` when capturedId is null and inserts it after exec when known", () => {
  const fresh = {agentName: "codex", capturedId: null, name: "promptmill", uuid: "ignored-for-codex"}
  const freshArgs = getAgent("codex").buildArgs(80, "pretty", [], fresh)

  assert.equal(freshArgs[0], "exec")
  assert.notEqual(freshArgs[1], "resume")

  const resumed = {agentName: "codex", capturedId: "01ABCDEF-1234-5678-90AB-CDEF12345678", name: "promptmill", uuid: "ignored"}
  const resumedArgs = getAgent("codex").buildArgs(80, "pretty", [], resumed)

  assert.deepEqual(resumedArgs.slice(0, 3), ["exec", "resume", resumed.capturedId])
})

test("antigravity.buildArgs pins --conversation only when capturedId is known", () => {
  const fresh = {agentName: "antigravity", capturedId: null, name: "promptmill", uuid: "ignored"}

  assert.ok(!getAgent("antigravity").buildArgs(80, "pretty", [], fresh).includes("--conversation"))

  const resumed = {agentName: "antigravity", capturedId: "conv-abc123", name: "promptmill", uuid: "ignored"}
  const resumedArgs = getAgent("antigravity").buildArgs(80, "pretty", [], resumed)

  assert.equal(valueAfter(resumedArgs, "--conversation"), "conv-abc123")
})

test("codex.buildArgs forces --json in text mode when a session id still needs capturing", () => {
  const session = {agentName: "codex", capturedId: null, name: "promptmill", uuid: "ignored"}
  const args = getAgent("codex").buildArgs(80, "text", [], session)

  // Without --json the extractor would never see thread.started; force it on
  // for the first capture run even though the user picked text mode.
  assert.ok(args.includes("--json"))
})

test("codex.buildArgs honors text mode once the session id is captured", () => {
  const session = {agentName: "codex", capturedId: "FAKE-THREAD", name: "promptmill", uuid: "ignored"}
  const args = getAgent("codex").buildArgs(80, "text", [], session)

  // Already captured — no reason to override the user's chosen format.
  assert.ok(!args.includes("--json"))
})

test("codex.extractSessionId parses thread.started events and ignores other JSON", () => {
  const codex = getAgent("codex")
  const session = {agentName: "codex", capturedId: null, name: "promptmill", uuid: "ignored"}

  assert.equal(codex.extractSessionId?.('{"type":"thread.started","thread_id":"01J3X…"}', session), "01J3X…")
  assert.equal(codex.extractSessionId?.('{"type":"turn.completed"}', session), null)
  assert.equal(codex.extractSessionId?.("not json", session), null)
})
