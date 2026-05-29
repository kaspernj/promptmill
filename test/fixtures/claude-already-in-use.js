// @ts-check
// Fake agent: emits Claude's "Session ID <UUID> is already in use." error on
// stderr and exits 1. Simulates the migration scenario where Claude already
// has a session under our deterministic UUID but promptmill never recorded
// the marker. runAgentBatch should persist the marker on the strength of this
// error so subsequent runs take the --resume path. The UUID is hardcoded so
// the regression test can match it; tests use the same literal.

process.stderr.write("Error: Session ID af0960f6-6d67-5859-a882-4b190358a709 is already in use.\n")
process.exit(1)
