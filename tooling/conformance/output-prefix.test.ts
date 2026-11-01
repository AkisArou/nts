import assert from "node:assert/strict";
import { test } from "node:test";
import { beforeTerminalDiagnostic, nativeDecline, outputPrefix, outputPrefixes } from "./output-prefix.ts";

test("a native stop may omit only a suffix of Node's output", () => {
  assert.equal(outputPrefix("before\n", "before\nfinally\n"), true);
  assert.equal(outputPrefix("", "finally\n"), true);
  assert.equal(outputPrefix("wrong\n", "right\nfinally\n"), false);
  assert.equal(outputPrefix("before\nextra\n", "before\n"), false);
  assert.equal(outputPrefix("before \n", "before\n"), false);
});

test("native refusals retain their authority separately from source throws and host faults", () => {
  assert.equal(nativeDecline("nts: refused: outside bounds\n"), true);
  assert.equal(nativeDecline("nts: refused at run time: unavailable representation\n"), true);
  assert.equal(nativeDecline("nts: uncaught TypeError: source throw\n"), false);
  assert.equal(nativeDecline('Exception in thread "main" java.lang.ClassCastException\n'), false);
});

test("stderr is checked too, retaining a program line shaped like a diagnostic", () => {
  assert.equal(outputPrefixes({ stdout: "", stderr: "wrong\n" }, { stdout: "", stderr: "right\n" }), false);
  assert.equal(beforeTerminalDiagnostic("nts: refused: printed by the program\nnts: refused: actual stop\n", "decline"), "nts: refused: printed by the program\n");
});
