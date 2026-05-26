// @ts-check
// Fake agent: two full lines plus a trailing partial line (no final newline),
// to exercise line-prefix buffering and the final flush.
process.stdout.write("alpha\nbeta\npartial")
