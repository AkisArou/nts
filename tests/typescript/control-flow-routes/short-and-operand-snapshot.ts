/*---
description: A typed && operand retains its value while its evaluation changes the state read by the right operand.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures]
---*/
// && selects from ShortValue after left rewrites state; node logs left before any right call and returns the saved operand or marker.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
function inspect(input: ShortValue, truthy: boolean, nullish: boolean): void {
  const log: unknown[] = []; let state: ShortValue = input;
  function left(): ShortValue { const value = state; state = replacement; log.push("left", value, "write", state); return value; }
  function right(): ShortValue { log.push("right", state); state = null; log.push("write", state); return marker; }
  const actual = left() && right();
  log.push("result", actual, state);
  let expected: ShortValue = input, finalState: ShortValue = replacement;
  const expectedLog: unknown[] = ["left", input, "write", replacement];
  if (truthy) { expected = marker; finalState = null; expectedLog.push("right", replacement, "write", null); }
  expectedLog.push("result", expected, finalState); same(actual, expected); same(state, finalState); assert.compareArray(log, expectedLog);
}
for (const row of rows) inspect(row[0], row[1], row[2]);
