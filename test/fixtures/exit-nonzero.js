// @ts-check
// Fake agent: print a marker line and exit non-zero.
process.stdout.write("fake agent failing\n")
process.exit(1)
