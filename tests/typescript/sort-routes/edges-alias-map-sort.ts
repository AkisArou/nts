/*---
description: A Map-held number array shares sort mutations and returned identity with its typed alias.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-map-set]
---*/
// Numbers cross a Map value and a second number[] alias; node exposes the same complete numeric order through both.
function compare(a: number, b: number): number { return a - b; }
function order(values: number[]): number[] { return values.sort(compare); }
const inputs: number[][] = [[], [2], [1, 1, 2, 3], [3, 2, 1, 1], [2, 2, 2, 2], [3, 1, 2, 1, 3, 2]];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push([3, 1, 2, 1, 3, 2][i % 6]);
  inputs.push(values);
}
for (const input of inputs) {
  const values = input.slice(), alias: number[] = values, stored = new Map<string, number[]>();
  stored.set("active", values);
  const reached = stored.get("active"); if (reached === undefined) throw new Error("missing array");
  const expected: number[] = [];
  for (const key of [1, 2, 3]) for (const value of input) if (value === key) expected.push(value);
  const result = order(reached);
  assert.sameValue(result, values); assert.sameValue(result, alias); assert.sameValue(stored.get("active"), result);
  assert.compareArray(result, expected); assert.compareArray(alias, expected); assert.compareArray(reached, expected);
}
