/*---
description: A handwritten memoized copy controls A Map parameter preserves object key and value sharing and recursively copied keys.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-interfaces, ts-numbers, ts-optional-properties, ts-map-set]
---*/
// A Map<Key, Key> parameter carries cyclic object keys used as their own values; node preserves key order and aliases in fresh objects.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface Key { n: number; next?: Key; }
function copyMap(source: Map<Key, Key>): Map<Key, Key> {
  const memory = new Map<Key, Key>();
  function copy(value: Key): Key {
    const old = memory.get(value); if (old !== undefined) return old;
    const result: Key = { n: value.n }; memory.set(value, result);
    if (value.next !== undefined) result.next = copy(value.next); return result;
  }
  const result: Map<Key, Key> = new Map();
  for (const [key, value] of source) result.set(copy(key), copy(value)); return result;
}
for (const numbers of [[], [-0], [NaN, -0, 7, 7]]) {
  const source: Map<Key, Key> = new Map();
  for (const n of numbers) { const key: Key = { n }; key.next = key; source.set(key, key); }
  const result = copyMap(source), originals = Array.from(source.keys()), copied = Array.from(result.keys());
  fresh(result, source, Map.prototype, []); same(result.size, numbers.length);
  assert.compareArray(copied.map(key => key.n), numbers);
  for (let i = 0; i < numbers.length; i++) {
    const before = originals[i], after = copied[i]; fresh(after, before, Object.prototype, ["n", "next"]);
    same(after.n, numbers[i]); same(after.next, after); same(result.get(after), after); same(result.has(before), false);
    after.n = 91; same(before.n, numbers[i]); before.n = 37; same(after.n, 91);
  }
  const extra: Key = { n: 5 }; result.set(extra, extra); same(source.has(extra), false);
  source.clear(); same(result.size, numbers.length + 1);
}
