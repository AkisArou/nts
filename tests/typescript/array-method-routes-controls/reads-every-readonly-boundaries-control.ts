/*---
description: "every is true on empty inputs without callbacks and stops at the first false callback on dense arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-arrow-functions]
---*/

function localEvery<T>(items: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean {
  for (let index = 0; index < items.length; index++) if (!predicate(items[index], index, items)) return false;
  return true;
}
// every is true on empty inputs without callbacks and stops at the first false callback on dense arrays. Route: a readonly array of readonly number-array inputs. Node prints reads-every-readonly-boundaries:ok.
const sources: readonly (readonly number[])[] = [[], [2], [3], [2, 4, 6], [2, 3, 4]];
const expected: readonly boolean[] = [true, true, false, true, false];
const visits: readonly (readonly number[])[] = [[], [2], [3], [2, 4, 6], [2, 3]];
for (let i = 0; i < sources.length; i++) {
  const items = sources[i], seen: number[] = [];
  const result = localEvery(items, value => { seen[seen.length] = value; return value % 2 === 0; });
  assert.sameValue(result, expected[i]); assert.compareArray(seen, visits[i]);
}
console.log("reads-every-readonly-boundaries:ok");
