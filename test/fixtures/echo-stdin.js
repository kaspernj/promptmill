// @ts-check
// Fake agent: echo stdin back to stdout, then exit 0.

/** @type {string[]} */
const chunks = []

process.stdin.on("data", (chunk) => {
  chunks.push(String(chunk))
})

process.stdin.on("end", () => {
  process.stdout.write(chunks.join(""))
})
