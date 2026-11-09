import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedReservation } from "./reservation.ts";

const GiB = 2 ** 30;
// The most the run could ever reserve: the machine's memory less the ledger's floor.
const budget = { slots: 24, bytes: 20 * GiB, fe: 24 };
const llvm = { slots: 8, min: 2, fe: true }, llvmBytes = 6 * GiB;

test("a pending fixed step cannot reserve memory held by other fixed steps", () => {
  // The measured run: tests 8 + test262-cases 8 + blockers 1 + outcomes 1.
  const fixed = { slots: 8 + 8 + 1 + 1, bytes: (8 + 8 + 1 + 1) * GiB, fe: 8 + 1 + 1 };
  assert.equal(fixedReservation(llvm, llvmBytes, fixed, budget), 0);
});

test("a satisfiable fixed step still reserves its minimum against elastic grants", () => {
  const fixed = { slots: 8 + 1 + 1, bytes: (8 + 1 + 1) * GiB, fe: 1 + 1 };
  assert.equal(fixedReservation(llvm, llvmBytes, fixed, budget), 2);
  assert.equal(fixedReservation(llvm, llvmBytes, { ...fixed, bytes: 14 * GiB }, budget), 2, "an exact memory fit is eligible");
});

test("the fixed CPU and frontend floors must also leave room for the minimum", () => {
  assert.equal(fixedReservation(llvm, llvmBytes, { slots: 23, bytes: 8 * GiB, fe: 8 }, budget), 0);
  assert.equal(fixedReservation(llvm, llvmBytes, { slots: 8, bytes: 8 * GiB, fe: 23 }, budget), 0);
  assert.equal(fixedReservation({ ...llvm, fe: false }, llvmBytes, { slots: 8, bytes: 8 * GiB, fe: 24 }, budget), 2);
});

test("the existing default minimum is clamped to the CPU budget", () => {
  assert.equal(fixedReservation({ slots: 8 }, GiB, { slots: 0, bytes: 0, fe: 0 }, { slots: 3, bytes: 20 * GiB, fe: 3 }), 3);
});
