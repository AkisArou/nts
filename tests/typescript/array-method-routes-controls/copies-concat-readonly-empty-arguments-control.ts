/*---
description: "Concat with no arguments or an empty array creates separate shallow copies even for empty and single sources through readonly arrays of dense input arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-unions, ts-type-aliases, ts-objects, ts-numbers, ts-strings, ts-null-undefined]
---*/

function localConcat<T>(items: readonly T[], ...parts: (readonly T[])[]): T[] {
  const result: T[] = [];
  for (const value of items) result[result.length] = value;
  for (const part of parts) for (const value of part) result[result.length] = value;
  return result;
}
// Concat with no arguments or an empty array creates separate shallow copies even for empty and single sources; route: readonly arrays of dense input arrays.
// Node prints copies-concat-readonly-empty-arguments:ok.
type Item = number | string | { id: number } | number[] | null | undefined;
const marker: { id: number } = { id: 7 }, nested: number[] = [2, 5];
const inputs: readonly (readonly Item[])[] = [[], [-0], [marker, nested, undefined, "tail"]];
for (const input of inputs) {
  const before: Item[] = [];
  for (const value of input) before[before.length] = value;
  const first = localConcat(input);
  const second = localConcat(input, []);
  assert.compareArray(first, before);
  assert.compareArray(second, before);
  assert.sameValue(first === input, false);
  assert.sameValue(second === input, false);
  assert.sameValue(first === second, false);
  if (first.length > 0) first[0] = null;
  assert.compareArray(input, before);
  assert.compareArray(second, before);
  assert.compareArray(nested, [2, 5]);
}
console.log("copies-concat-readonly-empty-arguments:ok");
