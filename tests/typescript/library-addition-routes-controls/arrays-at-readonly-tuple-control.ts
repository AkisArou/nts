/*---
description: "Control for arrays-at-readonly-tuple; at uses relative integer indices through a readonly tuple and preserves SameValue elements."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-readonly, ts-tuples, ts-destructuring, ts-type-aliases, ts-unions, ts-null-undefined, ts-typeof-operator, ts-conversions]
---*/
// at crosses a readonly tuple parameter; node truncates fractions, treats negative zero as the first slot, and returns undefined beyond either end without changing the tuple. The control uses older indexed loops in place of the new method.
const log: string[] = [];
type Source = readonly [number, number, number];
function check(source: Source, index: number, expected: number | undefined): void {
  const before = source.slice(); log.length = 0;
  const relative = Math.trunc(index) || 0, at = relative < 0 ? source.length + relative : relative;
  const result = at < 0 || at >= source.length ? undefined : source[at];
  assert.compareArray(log, []);
  assert.sameValue(result, expected); assert.sameValue(typeof result, expected === undefined ? "undefined" : "number");
  assert.compareArray(source, before); assert.sameValue(source.length, 3); assert.compareArray(Object.keys(source), ["0", "1", "2"]);
}
for (const first of [2, 9]) {
  const source: Source = [first, -0, NaN];
  const rows: [number, number | undefined][] = [[-0, first], [-0.75, first], [NaN, first], [1.9, -0], [-1, NaN], [-1.9, NaN], [-3, first], [-3.9, first], [3, undefined], [-4, undefined], [Infinity, undefined], [-Infinity, undefined]];
  for (const [index, expected] of rows) check(source, index, expected);
}
