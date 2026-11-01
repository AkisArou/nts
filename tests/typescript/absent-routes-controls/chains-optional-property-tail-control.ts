/*---
description: Control for chains-optional-property-tail; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces]
---*/
// A required branch payload, presence flag and recorded keys select the same tail with an explicit null/undefined check.
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
interface ChainBranch { leaf: { read(step: number): AbsentValue } }
for (const [value] of samples) for (const mode of [0, 1, 2, 3]) {
  let calls = 0; const seen: number[] = [];
  const branch: ChainBranch = { leaf: { read(step) { seen.push(step); return value; } } };
  const root = { present: mode !== 0, value: mode === 1 || mode === 0 ? undefined : mode === 2 ? null : branch };
  const keys = root.present ? ["branch"] : [], current = root.present ? root.value : undefined;
  const actual = current === null || current === undefined ? undefined : current.leaf.read(++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same(keys.includes("branch"), mode !== 0); same(root.present, mode !== 0);
  assert.compareArray(keys, mode === 0 ? [] : ["branch"]);
  const json = !root.present || root.value === undefined ? "{}" : '{"branch":' + JSON.stringify(root.value) + '}';
  same(json, mode < 2 ? "{}" : mode === 2 ? '{"branch":null}' : '{"branch":{"leaf":{}}}');
}
