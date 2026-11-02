/*---
description: "Explicit starts and resets retain their auto-incremented numeric members through typed parameters and returns."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-tuples, ts-enum, ts-enum-reverse-mapping]
---*/
// Offset restarts at 3, -2 and 9; a typed function calls a second typed return, and node logs each member twice with its exact reverse name.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum Offset { First = 3, Next, Negative = -2, AfterNegative, Last = 9, AfterLast }
const log: unknown[] = [];
function returnValue(value: Offset): Offset { log.push("return", value); return value; }
function pass(value: Offset): Offset { log.push("parameter", value); return returnValue(value); }
const rows: [Offset, number, string][] = [[Offset.First, 3, "First"], [Offset.Next, 4, "Next"], [Offset.Negative, -2, "Negative"], [Offset.AfterNegative, -1, "AfterNegative"], [Offset.Last, 9, "Last"], [Offset.AfterLast, 10, "AfterLast"]];
for (const [input, expected, name] of rows) {
  log.length = 0; const result: Offset = pass(input); same(input, expected); same(result, expected); same(Offset[result], name);
  same(pass(result), expected); exact(log, ["parameter", expected, "return", expected, "parameter", expected, "return", expected]);
}
