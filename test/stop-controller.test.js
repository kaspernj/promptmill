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

test("the first SIGINT requests a graceful stop without interrupting", () => {
  const {stdout, text} = collectingStream()
  let interrupts = 0
  const controller = createStopController({onInterrupt: () => {interrupts += 1}, stdout})

  assert.equal(controller.shouldStop(), false)

  controller.handleSignal("SIGINT")

  assert.equal(controller.shouldStop(), true)
  assert.equal(interrupts, 0)
  assert.match(text(), /Graceful stop/)
  assert.match(text(), /current run will finish/)
})

test("the second SIGINT interrupts immediately", () => {
  const {stdout, text} = collectingStream()
  let interrupts = 0
  const controller = createStopController({onInterrupt: () => {interrupts += 1}, stdout})

  controller.handleSignal("SIGINT")
  controller.handleSignal("SIGINT")

  assert.equal(interrupts, 1)
  assert.match(text(), /Interrupting the current run/)
})

test("SIGTERM interrupts immediately without a graceful stage", () => {
  const {stdout} = collectingStream()
  let interrupts = 0
  const controller = createStopController({onInterrupt: () => {interrupts += 1}, stdout})

  controller.handleSignal("SIGTERM")

  assert.equal(interrupts, 1)
  assert.equal(controller.shouldStop(), false)
})
