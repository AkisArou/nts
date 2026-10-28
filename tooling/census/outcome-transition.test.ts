import assert from "node:assert/strict";
import { test } from "node:test";
import { outcomeDisposition, outcomeTransition } from "../conformance/outcome-transition.ts";

test("outcomes and TypeScript observations share the progress vocabulary", () => {
  for (const [corpus, suite] of [["agrees", "pass"], ["wrong-answer", "wrong"],
    ["refused", "refused"], ["invalid-hir", "invalid-hir"], ["aborted", "runtime-abort"]]) {
    assert.equal(outcomeDisposition(corpus), outcomeDisposition(suite));
  }
  assert.throws(() => outcomeDisposition("not-measured"), /unknown outcome/);
  for (const before of ["wrong-answer", "invalid-hir", "aborted", "uncompilable-c"]) {
    assert.deepEqual(outcomeTransition(outcomeDisposition(before), outcomeDisposition("refused"), false),
      { word: "REFUSES NOW", ok: true, loud: true });
  }
  assert.deepEqual(outcomeTransition("refused", "defect", false), { word: "CHANGED", ok: false, loud: false });
  assert.deepEqual(outcomeTransition("pass", "defect", false), { word: "REGRESSED", ok: false, loud: false });
});
