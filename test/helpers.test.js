// @ts-check
import assert from "node:assert/strict"
import test from "node:test"

import {buildLogFileName, integerOption, timestampForLogFile} from "../src/helpers.js"

test("timestampForLogFile zero-pads to YYYYMMDD-HHMMSS", () => {
  assert.equal(timestampForLogFile(new Date(2026, 4, 9, 8, 7, 6)), "20260509-080706")
})

test("integerOption falls back when empty, null, or undefined", () => {
  assert.equal(integerOption("", {fallback: 100, minimum: 0, name: "runs"}), 100)
  assert.equal(integerOption(undefined, {fallback: 80, minimum: 1, name: "max-turns"}), 80)
  assert.equal(integerOption(null, {fallback: 7, minimum: 0, name: "runs"}), 7)
})

test("integerOption parses valid integers (including the minimum)", () => {
  assert.equal(integerOption("5", {fallback: 100, minimum: 0, name: "runs"}), 5)
  assert.equal(integerOption("0", {fallback: 100, minimum: 0, name: "runs"}), 0)
})

test("integerOption rejects non-integers and below-minimum values", () => {
  assert.throws(
    () => integerOption("abc", {fallback: 100, minimum: 0, name: "runs"}),
    /runs must be an integer greater than or equal to 0\./
  )
  assert.throws(
    () => integerOption("0", {fallback: 80, minimum: 1, name: "max-turns"}),
    /max-turns must be an integer greater than or equal to 1\./
  )
})

test("buildLogFileName composes prefix, run number, and timestamp", () => {
  assert.equal(
    buildLogFileName({logFilePrefix: "claude-run-", runNumber: 3, timestamp: "20260509-080706"}),
    "claude-run-3-20260509-080706.log"
  )
})
