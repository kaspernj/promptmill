// @ts-check

/**
 * @typedef {object} StopController
 * @property {() => boolean} shouldStop - Whether a graceful stop has been requested.
 * @property {(signal: "SIGINT" | "SIGTERM") => void} handleSignal - Feeds a received signal into the controller.
 */

/**
 * Creates a two-stage stop controller for Ctrl+C handling.
 *
 * The first SIGINT requests a graceful stop (the in-flight run is left to
 * finish; {@link StopController.shouldStop} flips to `true` so the batch loop
 * stops before starting the next run) and prints a confirmation. A second
 * SIGINT — or any SIGTERM — runs `onInterrupt` to stop immediately.
 * @param {object} options - Controller options.
 * @param {import("node:stream").Writable} options.stdout - Sink for the confirmation messages.
 * @param {() => void} options.onInterrupt - Interrupts the active run and exits now.
 * @returns {StopController} - The stop controller.
 */
export function createStopController({stdout, onInterrupt}) {
  let stopRequested = false
  let sigintCount = 0

  return {
    shouldStop: () => stopRequested,
    handleSignal(signal) {
      if (signal === "SIGTERM") {
        onInterrupt()

        return
      }

      sigintCount += 1

      if (sigintCount === 1) {
        stopRequested = true
        stdout.write("\n\n⚠ Graceful stop: the current run will finish, then promptmill exits without starting the next run. Press Ctrl+C again to interrupt now.\n")
      } else {
        stdout.write("\nInterrupting the current run…\n")
        onInterrupt()
      }
    }
  }
}
