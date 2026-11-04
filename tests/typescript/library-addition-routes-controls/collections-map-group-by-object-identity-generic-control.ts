/*---
description: "Map grouping keeps object keys by identity through a generic callback parameter. The control uses earlier operations."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-generics, ts-readonly, ts-class, ts-class-fields, ts-this, ts-to-primitive]
---*/
// Map.groupBy crosses a generic callback parameter; node preserves distinct object identities, never converts keys, and keeps a group when a later callback mutates its key object. The control spells out the same steps.
const log: string[] = [];
class Key {
  text: string = "same"; name: string;
  constructor(name: string) { log.push("construct:" + name); this.name = name; }
  toString(): string { log.push("toString:" + this.name); return this.text; }
  valueOf(): number { log.push("valueOf:" + this.name); return 1; }
}
function apply<K>(items: readonly number[], callback: (value: number, index: number) => K): Map<K, number[]> { log.push("apply");
  const result = new Map<K, number[]>(); let index = 0;
  for (const value of items) { const key = callback(value, index++), bucket = result.get(key); if (bucket === undefined) result.set(key, [value]); else bucket.push(value); }
  return result;
}
for (const offset of [2, 10]) {
  const first = new Key("first"), second = new Key("second"), keys = [first, second, first, second], items = [offset, offset + 1, offset + 2, offset + 3];
  function select(value: number, index: number): Key { log.push("callback:" + index + ":" + value); if (index === 2) first.text = "changed"; return keys[index]; }
  log.length = 0; const result = apply(items, select), stored: ReadonlyMap<Key, number[]> = result;
  assert.compareArray(log, ["apply", "callback:0:" + offset, "callback:1:" + (offset + 1), "callback:2:" + (offset + 2), "callback:3:" + (offset + 3)]);
  const a = stored.get(first), b = stored.get(second); if (a === undefined || b === undefined) throw new Test262Error("missing group");
  assert.compareArray([...stored.keys()], [first, second]); assert.sameValue(stored.size, 2);
  assert.compareArray(a, [offset, offset + 2]); assert.compareArray(b, [offset + 1, offset + 3]); assert.sameValue(a === b, false); assert.sameValue(a === items, false);
  assert.sameValue(first.text, "changed"); assert.sameValue(second.text, "same"); assert.compareArray(items, [offset, offset + 1, offset + 2, offset + 3]);
}
