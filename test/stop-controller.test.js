// @ts-check
import assert from "node:assert/strict"
import {Writable} from "node:stream"
import test from "node:test"

import {createStopController} from "../src/stop-controller.js"

/** @returns {{stdout: Writable, text: () => string}} - A writable that captures everything written to it. */
function collectingStream() {
  /** @type {string[]} */
  const chunks = []
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk))
      callback()
    }
  })

  return {stdout, text: () => chunks.join("")}
}

/** @returns {{onInterrupt: (signal: "SIGINT" | "SIGTERM") => void, signals: ("SIGINT" | "SIGTERM")[]}} - A spy recording forwarded signals. */
function interruptSpy() {
  /** @type {("SIGINT" | "SIGTERM")[]} */
  const signals = []

  return {onInterrupt: (signal) => {signals.push(signal)}, signals}
}

test("the first SIGINT requests a graceful stop without interrupting", () => {
  const {stdout, text} = collectingStream()
  const spy = interruptSpy()
  const controller = createStopController({onInterrupt: spy.onInterrupt, stdout})

  assert.equal(controller.shouldStop(), false)

  controller.handleSignal("SIGINT")

  assert.equal(controller.shouldStop(), true)
  assert.deepEqual(spy.signals, [])
  assert.match(text(), /Graceful stop/)
  assert.match(text(), /current run will finish/)
})

test("the second SIGINT interrupts immediately, forwarding SIGINT", () => {
  const {stdout, text} = collectingStream()
  const spy = interruptSpy()
  const controller = createStopController({onInterrupt: spy.onInterrupt, stdout})

  controller.handleSignal("SIGINT")
  controller.handleSignal("SIGINT")

  assert.deepEqual(spy.signals, ["SIGINT"]) // the explicit SIGINT is forwarded, not downgraded to SIGTERM
  assert.match(text(), /Interrupting the current run/)
})

test("SIGTERM interrupts immediately, forwarding SIGTERM, without a graceful stage", () => {
  const {stdout} = collectingStream()
  const spy = interruptSpy()
  const controller = createStopController({onInterrupt: spy.onInterrupt, stdout})

  controller.handleSignal("SIGTERM")

  assert.deepEqual(spy.signals, ["SIGTERM"])
  assert.equal(controller.shouldStop(), false)
})
