// @ts-check
// Fake agent: emits a Claude-style `system.init` event on stdout, then exits 1.
// Simulates the user-reported scenario where a Claude run creates the session
// and then later fails (e.g. with error_max_turns). runAgentBatch must still
// persist the session marker, because the session was created the moment
// Claude accepted `--session-id`.

process.stdout.write('{"type":"system","subtype":"init","model":"claude-opus-4-7"}\n')
process.exit(1)
