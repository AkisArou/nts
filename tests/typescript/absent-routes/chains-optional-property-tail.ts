/*---
description: An optional typed branch suppresses its remaining property and call chain when absent, undefined or null.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-optional-properties, ts-optional-chaining]
---*/
// An optional branch is absent, undefined, null or a typed object; node skips the entire leaf call and its increment until the branch exists.
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
  const root: { branch?: ChainBranch | null } = mode === 0 ? {} : { branch: mode === 1 ? undefined : mode === 2 ? null : branch };
  const actual = root.branch?.leaf.read(++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same("branch" in root, mode !== 0); same(Object.hasOwn(root, "branch"), mode !== 0);
  assert.compareArray(Object.keys(root), mode === 0 ? [] : ["branch"]);
  same(JSON.stringify(root), mode < 2 ? "{}" : mode === 2 ? '{"branch":null}' : '{"branch":{"leaf":{}}}');
}
