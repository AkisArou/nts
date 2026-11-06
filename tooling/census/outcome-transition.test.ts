import assert from "node:assert/strict";
import { test } from "node:test";
import { improves, outcomeDisposition, outcomeTransition, type OutcomeDisposition } from "../conformance/outcome-transition.ts";

test("outcomes and TypeScript observations share the progress vocabulary", () => {
  for (const [corpus, suite] of [["agrees", "pass"], ["wrong-answer", "wrong"],
    ["refused", "refused"], ["invalid-hir", "invalid-hir"], ["aborted", "runtime-abort"]]) {
    assert.equal(outcomeDisposition(corpus), outcomeDisposition(suite));
  }
  for (const kind of ["wrong", "wrong-output", "wrong-answer"]) assert.equal(outcomeDisposition(kind), "silent", kind);
  for (const kind of ["invalid-hir", "runtime-abort", "aborted", "uncompilable-c", "compiler-crash", "build-failure"]) {
    assert.equal(outcomeDisposition(kind), "loud", kind);
  }
  assert.throws(() => outcomeDisposition("not-measured"), /unknown outcome/);
  for (const before of ["wrong-answer", "invalid-hir", "aborted", "uncompilable-c"]) {
    assert.deepEqual(outcomeTransition(outcomeDisposition(before), outcomeDisposition("refused"), false),
      { word: "REFUSES NOW", ok: true, loud: true });
  }
});

test("the ratchet orders pass > refused > loud defect > silent wrong answer", () => {
  const words: Record<string, string> = {
    "silent silent": "CHANGED", "silent loud": "LOUD NOW", "silent refused": "REFUSES NOW", "silent pass": "FIXED",
    "loud silent": "REGRESSED", "loud loud": "CHANGED", "loud refused": "REFUSES NOW", "loud pass": "FIXED",
    "refused silent": "REGRESSED", "refused loud": "REGRESSED", "refused refused": "CHANGED", "refused pass": "FIXED",
    "pass silent": "REGRESSED", "pass loud": "REGRESSED", "pass refused": "REGRESSED", "pass pass": "REGRESSED",
  };
  const order: OutcomeDisposition[] = ["silent", "loud", "refused", "pass"];
  for (const before of order) {
    assert.deepEqual(outcomeTransition(before, before, true), { word: before === "pass" ? "holds" : "reproduces", ok: true, loud: false });
    for (const after of order) {
      const transition = outcomeTransition(before, after, false);
      assert.equal(transition.word, words[`${before} ${after}`], `${before} -> ${after}`);
      assert.equal(transition.ok, improves(transition), `${before} -> ${after}: only an improvement passes`);
      assert.equal(transition.loud, improves(transition), `${before} -> ${after}: and every improvement is listed`);
    }
  }
});
