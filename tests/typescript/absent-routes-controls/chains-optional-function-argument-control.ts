/*---
description: Control for chains-optional-function-argument; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-function-types, ts-arrow-functions, ts-closures]
---*/
// The function payload and presence flag are required, and an explicit null/undefined branch controls argument evaluation and the call.
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
  const slot = { present: mode !== 0, value: mode < 2 ? undefined : mode === 2 ? null : run };
  const keys = slot.present ? ["f"] : [], f = slot.present ? slot.value : undefined;
  const actual = f === undefined || f === null ? undefined : f(++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same(keys.includes("f"), mode !== 0); same(slot.present, mode !== 0);
  assert.compareArray(keys, mode === 0 ? [] : ["f"]);
  const json = slot.present && slot.value === null ? '{"f":null}' : '{}';
  same(json, mode === 2 ? '{"f":null}' : '{}');
}
