/*---
description: "Explicit-object control: Explicit starts and resets retain their auto-incremented numeric members through typed parameters and returns."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-tuples, ts-objects, ts-type-aliases, ts-record, ts-unions, ts-literal-types]
---*/
// Offset restarts at 3, -2 and 9; a typed function calls a second typed return, and node logs each member twice with its exact reverse name. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Offset = 3 | 4 | -2 | -1 | 9 | 10;
const Offset = Object.freeze({ First: 3, Next: 4, Negative: -2, AfterNegative: -1, Last: 9, AfterLast: 10 });
const OffsetReverse: Readonly<Record<number, string | undefined>> = Object.freeze({ 3: "First", 4: "Next", "-2": "Negative", "-1": "AfterNegative", 9: "Last", 10: "AfterLast" });
const log: unknown[] = [];
function returnValue(value: Offset): Offset { log.push("return", value); return value; }
function pass(value: Offset): Offset { log.push("parameter", value); return returnValue(value); }
const rows: [Offset, number, string][] = [[Offset.First, 3, "First"], [Offset.Next, 4, "Next"], [Offset.Negative, -2, "Negative"], [Offset.AfterNegative, -1, "AfterNegative"], [Offset.Last, 9, "Last"], [Offset.AfterLast, 10, "AfterLast"]];
for (const [input, expected, name] of rows) {
  log.length = 0; const result: Offset = pass(input); same(input, expected); same(result, expected); same(OffsetReverse[result], name);
  same(pass(result), expected); exact(log, ["parameter", expected, "return", expected, "parameter", expected, "return", expected]);
}
