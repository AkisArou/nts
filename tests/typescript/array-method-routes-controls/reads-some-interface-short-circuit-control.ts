/*---
description: "some stops immediately at the first true callback and visits every element only when no callback succeeds. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

function localSome<T>(items: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean {
  for (let index = 0; index < items.length; index++) if (predicate(items[index], index, items)) return true;
  return false;
}
// some stops immediately at the first true callback and visits every element only when no callback succeeds. Route: two interface implementations supplying opposite tests. Node prints reads-some-interface-short-circuit:ok.
interface SomeCheck { test(value: number): boolean; }
class AboveTen implements SomeCheck { test(value: number): boolean { return value > 10; } }
class BelowZero implements SomeCheck { test(value: number): boolean { return value < 0; } }
const items: readonly number[] = [5, 12, -3, 130, -7];
const rows: readonly [SomeCheck, readonly number[], boolean, readonly number[]][] = [
  [new AboveTen(), items, true, [5, 12]], [new BelowZero(), items, true, [5, 12, -3]],
  [new AboveTen(), [1, 2], false, [1, 2]], [new BelowZero(), [], false, []]
];
for (const [checker, source, expected, visits] of rows) {
  const seen: number[] = [];
  const found = localSome(source, value => { seen[seen.length] = value; return checker.test(value); });
  assert.sameValue(found, expected); assert.compareArray(seen, visits);
}
console.log("reads-some-interface-short-circuit:ok");
