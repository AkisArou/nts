/*---
description: "Strong-collection control for cache-set-map-values: Set values retrieved from a typed Map retain separate object membership and exact deletion answers."
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-map-set, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions, ts-null-undefined, ts-strings]
---*/
// Sets travel as Map values; node retrieves the exact collection and keeps equal-content keys distinct across independent memberships.
class DirectoryKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new DirectoryKey(), new DirectoryKey()]];
for (const [key, twin] of pairs) {
  const first: Set<object> = new Set(), second: Set<object> = new Set();
  const directory: Map<string, Set<object>> = new Map();
  assert.sameValue(directory.set("first", first), directory); assert.sameValue(directory.set("second", second), directory);
  assert.sameValue(first.add(key), first); assert.sameValue(second.add(twin), second);
  const routes: [string, Set<object>, object, object][] = [["first", first, key, twin], ["second", second, twin, key]];
  for (const [label, expected, presentKey, absentKey] of routes) {
    const selected = directory.get(label); assert.sameValue(selected, expected); assert.sameValue(directory.has(label), true);
    if (selected === undefined) throw new Error("missing cache");
    assert.sameValue(selected.has(presentKey), true); assert.sameValue(selected.has(absentKey), false); assert.sameValue(selected.delete(absentKey), false);
    assert.sameValue(selected.add(presentKey), selected); assert.sameValue(selected.has(presentKey), true);
    assert.sameValue(selected.delete(presentKey), true); assert.sameValue(selected.delete(presentKey), false); assert.sameValue(selected.has(presentKey), false);
    assert.sameValue(directory.delete(label), true); assert.sameValue(directory.delete(label), false);
    assert.sameValue(directory.get(label), undefined); assert.sameValue(directory.has(label), false);
  }
}
