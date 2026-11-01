/*---
description: A handwritten memoized copy controls An interface containing a Map and Set preserves shared cyclic objects across both collections.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-interfaces, ts-numbers, ts-strings, ts-optional-properties, ts-map-set]
---*/
// A Catalog interface carries a Map and Set sharing cyclic entries; node gives fresh collections with one shared copy of each entry.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface Entry { n: number; next?: Entry; }
interface Catalog { lookup: Map<string, Entry>; members: Set<Entry>; }
function copyCatalog(source: Catalog): Catalog {
  const memory = new Map<Entry, Entry>();
  function copy(value: Entry): Entry {
    const old = memory.get(value); if (old !== undefined) return old;
    const result: Entry = { n: value.n }; memory.set(value, result);
    if (value.next !== undefined) result.next = copy(value.next); return result;
  }
  const result: Catalog = { lookup: new Map(), members: new Set() };
  for (const [key, value] of source.lookup) result.lookup.set(key, copy(value));
  for (const value of source.members) result.members.add(copy(value)); return result;
}
for (const numbers of [[], [-0], [NaN, 7, 7]]) {
  const source: Catalog = { lookup: new Map(), members: new Set() };
  for (let i = 0; i < numbers.length; i++) { const entry: Entry = { n: numbers[i] }; entry.next = entry; source.lookup.set("k" + i, entry); source.members.add(entry); }
  const result = copyCatalog(source); fresh(result, source, Object.prototype, ["lookup", "members"]);
  fresh(result.lookup, source.lookup, Map.prototype, []); fresh(result.members, source.members, Set.prototype, []);
  assert.compareArray(Array.from(result.lookup.keys()), numbers.map((_, i) => "k" + i)); same(result.members.size, numbers.length);
  const members = Array.from(result.members); assert.compareArray(members.map(entry => entry.n), numbers);
  for (let i = 0; i < numbers.length; i++) {
    const before = source.lookup.get("k" + i), after = result.lookup.get("k" + i); if (before === undefined || after === undefined) throw new Error("entry");
    fresh(after, before, Object.prototype, ["n", "next"]); same(after, members[i]); same(after.next, after); same(after.n, numbers[i]);
    after.n = 9; same(before.n, numbers[i]); before.n = 11; same(after.n, 9);
  }
  result.lookup.set("extra", { n: 1 }); same(source.lookup.has("extra"), false); source.members.clear(); same(result.members.size, numbers.length);
}
