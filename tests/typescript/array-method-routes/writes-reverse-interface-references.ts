/*---
description: "Reverse retains object and nested-array identities while changing the same receiver through each implementation through two interface implementations holding mixed arrays."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

// Reverse retains object and nested-array identities while changing the same receiver through each implementation; route: two interface implementations holding mixed arrays.
// Node prints writes-reverse-interface-references:ok.
type Item = string | number[] | { id: number } | null | undefined;
const first: { id: number } = { id: 1 }, second: { id: number } = { id: 2 }, nested: number[] = [2, 5];
interface Reversible { turn(): Item[]; read(): readonly Item[] }
class FirstArray implements Reversible {
  items: Item[] = [first, nested, undefined, "tail"];
  turn(): Item[] { return this.items.reverse(); }
  read(): readonly Item[] { return this.items; }
}
class SecondArray implements Reversible {
  values: Item[] = [null, second, first];
  turn(): Item[] { return this.values.reverse(); }
  read(): readonly Item[] { return this.values; }
}
const rows: readonly [Reversible, readonly Item[]][] = [[new FirstArray(), ["tail", undefined, nested, first]], [new SecondArray(), [first, second, null]]];
for (const [route, expected] of rows) {
  const original = route.read(), result = route.turn();
  assert.sameValue(result === original, true);
  assert.sameValue(route.read() === original, true);
  assert.compareArray(result, expected);
  assert.compareArray(original, expected);
  assert.compareArray(nested, [2, 5]);
}
console.log("writes-reverse-interface-references:ok");
