// @ts-check
// Fake agent: emits a Codex-style `thread.started` NDJSON line on stdout, then
// exits. Used to exercise runAgentBatch's session-capture path.

process.stdout.write('{"type":"thread.started","thread_id":"FAKE-THREAD-001"}\n')
process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n')
