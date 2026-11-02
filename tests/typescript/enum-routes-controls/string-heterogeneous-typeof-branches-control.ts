/*---
description: "Control for string-heterogeneous-typeof-branches; Typeof and equality narrow heterogeneous enum parameters to the correct numeric or string member branches."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-unions, ts-literal-types, ts-narrowing, ts-type-aliases]
---*/
// Every BranchChoice, including its alias, crosses one parameter; node logs the narrowed member kind and exactly one branch before returning its label. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const BranchChoice = Object.freeze({ Zero: 0, TextZero: "0", Two: 2, TextTwo: "2", Empty: "", Again: 0 }); type BranchChoice = 0 | "0" | 2 | "2" | "";
function classify(value: BranchChoice, log: unknown[]): string {
  if (typeof value === "number") {
    const narrowed: 0 | 2 = value; log.push("number", narrowed, typeof narrowed);
    if (value === BranchChoice.Zero) { log.push("zero", value); return "numeric-zero"; }
    log.push("two", value); return "numeric-two";
  }
  const narrowed: "0" | "2" | "" = value; log.push("string", narrowed, typeof narrowed);
  if (value === BranchChoice.TextZero) { log.push("text-zero", value); return "text-zero"; }
  if (value === BranchChoice.TextTwo) { log.push("text-two", value); return "text-two"; }
  log.push("empty", value); return "empty";
}
const inputs: BranchChoice[] = [BranchChoice.Zero, BranchChoice.TextZero, BranchChoice.Two, BranchChoice.TextTwo, BranchChoice.Empty, BranchChoice.Again];
const raw: (number | string)[] = [0, "0", 2, "2", "", 0], branches = ["zero", "text-zero", "two", "text-two", "empty", "zero"], answers = ["numeric-zero", "text-zero", "numeric-two", "text-two", "empty", "numeric-zero"];
for (let at = 0; at < inputs.length; at++) {
  const log: unknown[] = [], result = classify(inputs[at], log); same(inputs[at], raw[at]); same(result, answers[at]); log.push("return", result);
  exact(log, [typeof raw[at], raw[at], typeof raw[at], branches[at], raw[at], "return", answers[at]]);
}
