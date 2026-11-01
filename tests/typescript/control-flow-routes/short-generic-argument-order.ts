/*---
description: Ordered side-effecting arguments retain three different snapshots through one generic call.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-generics]
---*/
// ShortValue arguments cross gather<T> after each operand rewrites shared state; node preserves input, replacement and undefined snapshots and the full call order.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
function inspect(input: ShortValue): void {
  const log: unknown[] = []; let state: ShortValue = input;
  function first(): ShortValue { const value = state; state = replacement; log.push("first", value, "write", state); return value; }
  function second(): ShortValue { const value = state; state = undefined; log.push("second", value, "write", state); return value; }
  function third(): ShortValue { const value = state; state = null; log.push("third", value, "write", state); return value; }
  function gather<T>(a: T, b: T, c: T): T[] { log.push("call", a, b, c); return [a, b, c]; }
  const actual = gather(first(), second(), third());
  same(actual.length, 3); same(actual[0], input); same(actual[1], replacement); same(actual[2], undefined); same(state, null);
  assert.compareArray(log, ["first", input, "write", replacement, "second", replacement, "write", undefined, "third", undefined, "write", null, "call", input, replacement, undefined]);
}
for (const row of rows) inspect(row[0]);
