/*---
description: A generic groupBy fills a Map from keys to arrays, at the key and value types of the call.
features: [ts-generics, ts-map-set]
---*/
function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
const byLength = groupBy(["a", "bb", "c", "dd", "eee"], (s) => s.length);
assert.compareArray(byLength.get(1) ?? [], ["a", "c"]);
assert.compareArray(byLength.get(3) ?? [], ["eee"]);
const byParity = groupBy([1, 2, 3, 4, 5], (n) => n % 2 === 0);
assert.sameValue(byParity.get(true)?.length, 2);
