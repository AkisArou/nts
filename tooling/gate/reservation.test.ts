import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedReservation } from "./reservation.ts";

const budget = { slots: 24, mem: 20, fe: 24 };
const llvm = { slots: 8, min: 2, mem: 6, fe: true };

test("a pending fixed step cannot reserve memory held by other fixed steps", () => {
  // The measured train: tests 8 + test262-cases 8 + blockers 1 + outcomes 1.
  const fixed = { slots: 8 + 8 + 1 + 1, mem: 8 + 8 + 1 + 1, fe: 8 + 1 + 1 };
  assert.equal(fixedReservation(llvm, fixed, budget), 0);
});

test("a satisfiable fixed step still reserves its minimum against elastic grants", () => {
  const fixed = { slots: 8 + 1 + 1, mem: 8 + 1 + 1, fe: 1 + 1 };
  assert.equal(fixedReservation(llvm, fixed, budget), 2);
  assert.equal(fixedReservation(llvm, { ...fixed, mem: 14 }, budget), 2, "an exact memory fit is eligible");
});

test("the fixed CPU and frontend floors must also leave room for the minimum", () => {
  assert.equal(fixedReservation(llvm, { slots: 23, mem: 8, fe: 8 }, budget), 0);
  assert.equal(fixedReservation(llvm, { slots: 8, mem: 8, fe: 23 }, budget), 0);
  assert.equal(fixedReservation({ ...llvm, fe: false }, { slots: 8, mem: 8, fe: 24 }, budget), 2);
});

test("the existing default minimum is clamped to the CPU budget", () => {
  assert.equal(fixedReservation({ slots: 8, mem: 1 }, { slots: 0, mem: 0, fe: 0 }, { slots: 3, mem: 20, fe: 3 }), 3);
});
