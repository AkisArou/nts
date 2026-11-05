/*---
description: "find returns the first matching object itself and stops, including not-found and empty inputs. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-objects, ts-readonly, ts-unions, ts-null-undefined, ts-strings, ts-arrow-functions]
---*/

function localFind<T>(items: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => unknown): T | undefined {
  for (let index = 0; index < items.length; index++) if (predicate(items[index], index, items)) return items[index];
  return undefined;
}
// find returns the first matching object itself and stops, including not-found and empty inputs. Route: a constrained helper at two record type arguments. Node prints reads-find-generic-records:ok.
function inspect<T extends { id: number }>(items: readonly T[], limit: number, expected: T | undefined, visits: readonly number[]): void {
  const seen: number[] = [];
  const found = localFind(items, value => { seen[seen.length] = value.id; return value.id >= limit; });
  assert.sameValue(found === expected, true); assert.compareArray(seen, visits);
}
const first = { id: 2, label: "first" }, second = { id: 5, label: "second" }, third = { id: 2, label: "third" };
const left: readonly { id: number; label: string }[] = [first, second, third];
inspect<{ id: number; label: string }>(left, 2, first, [2]);
inspect<{ id: number; label: string }>(left, 3, second, [2, 5]);
inspect<{ id: number; label: string }>(left, 9, undefined, [2, 5, 2]);
const early = { id: 1, active: false }, late = { id: 4, active: true };
inspect<{ id: number; active: boolean }>([early, late], 4, late, [1, 4]);
inspect<{ id: number; active: boolean }>([], 0, undefined, []);
console.log("reads-find-generic-records:ok");
