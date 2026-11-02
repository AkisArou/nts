/*---
description: "An exhaustive switch over heterogeneous member types distinguishes numeric zero from textual zero and returns exact members."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-enum, ts-enum-string, ts-interfaces, ts-type-aliases, ts-unions, ts-literal-types, ts-narrowing, ts-never, ts-errors]
---*/
// A heterogeneous member union arrives through an interface; node logs one arm per input and never enters the never-typed default, including the numeric alias.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum NextChoice { Empty = "", Zero = 0, TextZero = "0", Negative = -1, Alias = Zero }
type ChoiceMember = NextChoice.Empty | NextChoice.Zero | NextChoice.TextZero | NextChoice.Negative | NextChoice.Alias;
interface ChoiceCell { value: ChoiceMember; }
function advance(cell: ChoiceCell, log: unknown[]): ChoiceMember {
  const value = cell.value; log.push("input", value, typeof value);
  switch (value) {
    case NextChoice.Empty: log.push("empty", value); return NextChoice.Zero;
    case NextChoice.Zero: log.push("zero", value); return NextChoice.TextZero;
    case NextChoice.TextZero: log.push("text-zero", value); return NextChoice.Negative;
    case NextChoice.Negative: log.push("negative", value); return NextChoice.Empty;
    default: { const impossible: never = value; log.push("default", impossible); throw new Test262Error("unexpected member"); }
  }
}
const inputs: ChoiceMember[] = [NextChoice.Empty, NextChoice.Zero, NextChoice.TextZero, NextChoice.Negative, NextChoice.Alias], raw: (number | string)[] = ["", 0, "0", -1, 0], answers: (number | string)[] = [0, "0", -1, "", "0"], branches = ["empty", "zero", "text-zero", "negative", "zero"];
for (let at = 0; at < inputs.length; at++) {
  const cell: ChoiceCell = { value: inputs[at] }, log: unknown[] = [], result = advance(cell, log);
  same(cell.value, raw[at]); same(result, answers[at]); log.push("return", result, typeof result);
  exact(log, ["input", raw[at], typeof raw[at], branches[at], raw[at], "return", answers[at], typeof answers[at]]);
}
