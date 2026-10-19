/*---
description: A type parameter constrained to a readonly array reads its length and elements and returns the array it was given.
features: [ts-generics, ts-generic-constraints, ts-readonly]
---*/
function longestList<T extends readonly number[]>(lists: T[]): T {
  let best = lists[0];
  for (const list of lists) if (list.length > best.length) best = list;
  return best;
}
function sum<T extends readonly number[]>(list: T): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}
const middle = [4, 5, 6];
const winner = longestList([[1], middle, [2, 3]]);
assert.sameValue(winner, middle);
assert.sameValue(sum(winner), 15);
assert.sameValue(sum([1, 2] as const), 3);
