import { test } from "node:test";
import assert from "node:assert/strict";
import { frontendBudget } from "./budget.ts";

test("frontend capacity follows the CPU slots unless explicitly overridden", () => {
  assert.equal(frontendBudget({}, 8), 8);
  assert.equal(frontendBudget({}, 24), 24);
  assert.equal(frontendBudget({ NTS_GATE_FRONTENDS: "3" }, 8), 3);
  assert.equal(frontendBudget({ NTS_GATE_FRONTENDS: "" }, 8), 8);
});

test("frontend overrides retain their existing numeric validation and rounding", () => {
  assert.equal(frontendBudget({ NTS_GATE_FRONTENDS: "3.9" }, 8), 3);
  for (const value of ["0", "-1", "NaN", "Infinity", "bad"]) {
    assert.throws(() => frontendBudget({ NTS_GATE_FRONTENDS: value }, 8), /is not a positive number/);
  }
});
