/*---
description: An optional typed function value skips its argument and returns undefined until callable.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-properties, ts-optional-chaining]
---*/
// An optional function is read into a typed alias; node skips its argument increment for absent, undefined and null values.
type AbsentValue = number | string | boolean | null | undefined | { tag: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { tag: "point" };
const samples: [AbsentValue, string, boolean, boolean][] = [
  [undefined, "null", true, true], [null, "null", true, true], [0, "0", false, true], [-0, "0", false, true],
  ["", '""', false, true], [NaN, "null", false, true], [false, "false", false, true],
  [point, '{"tag":"point"}', false, false], [7, "7", false, false], ["live", '"live"', false, false], [true, "true", false, false]
];
type OptionalRun = (step: number) => AbsentValue;
for (const [value] of samples) for (const mode of [0, 1, 2, 3]) {
  let calls = 0; const seen: number[] = [];
  const run: OptionalRun = step => { seen.push(step); return value; };
  const slot: { f?: OptionalRun | null } = mode === 0 ? {} : { f: mode === 1 ? undefined : mode === 2 ? null : run };
  const f = slot.f, actual = f?.(++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same("f" in slot, mode !== 0); same(Object.hasOwn(slot, "f"), mode !== 0);
  assert.compareArray(Object.keys(slot), mode === 0 ? [] : ["f"]);
  same(JSON.stringify(slot), mode === 2 ? '{"f":null}' : '{}');
}
