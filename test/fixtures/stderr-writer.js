// @ts-check
// Fake agent: writes a line to stdout and a line to stderr, to exercise
// stderr routing (logStderrOnly).
process.stdin.resume()
process.stdout.write("OUT-LINE\n")
process.stderr.write("ERR-LINE\n")
