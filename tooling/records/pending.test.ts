import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedLine, improvedLine, inventory, pendingLine, refusesDifferentlyLine } from "./pending.ts";

test("a case without a row is pending and a row without a case is stale", () => {
  assert.deepEqual(inventory(["a", "b"], ["b", "c", "d"]), { pending: ["c", "d"], stale: ["a"] });
  assert.deepEqual(inventory(["a"], ["a"]), { pending: [], stale: [] });
});

test("every check names a pending case and an improvement in one shared line", () => {
  assert.equal(pendingLine("tests/outcomes/new", "tests/outcomes/new/outcome.json"),
    "pending: tests/outcomes/new is not recorded in tests/outcomes/new/outcome.json yet");
  assert.equal(improvedLine("benchmarks/cases/x", "refused", "pass"), "improved, record pending: benchmarks/cases/x refused -> pass");
  assert.equal(refusesDifferentlyLine("tests/typescript/a.ts", "NTS1001", "NTS1100"), "refuses differently, record pending: tests/typescript/a.ts NTS1001 -> NTS1100");
  assert.equal(acceptedLine({ word: "REFUSES DIFFERENTLY", ok: true, loud: true }, "a", "b", "c"), refusesDifferentlyLine("a", "b", "c"));
  assert.equal(acceptedLine({ word: "LOUD NOW", ok: true, loud: true }, "a", "b", "c"), improvedLine("a", "b", "c"));
});
