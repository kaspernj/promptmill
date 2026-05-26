// @ts-check
// Fake agent: emits a few Claude stream-json (NDJSON) events, to exercise the
// pretty/render path end-to-end.
process.stdout.write(`${JSON.stringify({model: "claude-test", subtype: "init", type: "system"})}\n`)
process.stdout.write(`${JSON.stringify({message: {content: [{input: {command: "echo hi"}, name: "Bash", type: "tool_use"}]}, type: "assistant"})}\n`)
process.stdout.write(`${JSON.stringify({duration_ms: 1500, num_turns: 2, subtype: "success", total_cost_usd: 0.01, type: "result"})}\n`)
