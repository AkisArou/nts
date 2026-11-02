/*---
description: A widened factory method carries union array elements to WeakSet construction with exact key acceptance.
features: [ts-weak-collection-routes, ts-weak-collection-route-refused, ts-map-set, ts-unions, ts-symbols, ts-errors, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-unsound-bivariance, ts-class, ts-class-fields, ts-numbers, ts-bigint]
---*/
// WeakSet constructor elements cross a method-bivariant array parameter: node rejects refused keys, coalesces aliases and deletes a held key exactly once.
type Input = object | symbol | string | number | boolean | bigint | null | undefined;
function eligible(value: Input): boolean { return typeof value === "symbol" ? Symbol.keyFor(value) === undefined : typeof value === "function" || typeof value === "object" && value !== null; }
class Token { id: number; constructor(id: number) { this.id = id; } }
const rows: [Input, Input, boolean][] = [
  [{ id: 1 }, { id: 1 }, true], [[1], [1], true], [() => 1, () => 1, true], [new Token(1), new Token(1), true],
  [Symbol("same"), Symbol("same"), true], [Symbol.iterator, Symbol.toStringTag, true], [Symbol.for(""), Symbol.for(""), false], [Symbol.for("weak"), Symbol.for("weak"), false],
  [null, null, false], [undefined, undefined, false], [false, false, false], [true, true, false], ["", "", false], ["1", "1", false],
  [0, 0, false], [-0, -0, false], [NaN, NaN, false], [Infinity, Infinity, false], [-Infinity, -Infinity, false], [0n, 0n, false], [1n, 1n, false],
];
interface Builder { make(values: Input[]): WeakSet<object | symbol>; }
const builder: Builder = { make(values: (object | symbol)[]): WeakSet<object | symbol> { return new WeakSet<object | symbol>(values); } };
for (const [key, peer, accepted] of rows) {
  const anchor = {}; const values: Input[] = [anchor, key, peer, anchor]; assert.sameValue(eligible(key), accepted);
  if (eligible(key)) {
    const table: WeakSet<object | symbol> = builder.make(values);
    if ((typeof key === "symbol" || typeof key === "function" || typeof key === "object" && key !== null) && (typeof peer === "symbol" || typeof peer === "function" || typeof peer === "object" && peer !== null)) {
      assert.sameValue(table.has(key), true); assert.sameValue(table.has(anchor), true); assert.sameValue(table.add(key), table); assert.sameValue(table.has(key), true);
      assert.sameValue(table.delete(key), true); assert.sameValue(table.delete(key), false); assert.sameValue(table.has(key), false);
      assert.sameValue(table.has(peer), true); assert.sameValue(table.delete(peer), true); assert.sameValue(table.delete(peer), false); assert.sameValue(table.has(peer), false);
    } else { assert.sameValue(true, false); }
    assert.sameValue(table.has(anchor), true); assert.sameValue(table.delete(anchor), true); assert.sameValue(table.delete(anchor), false); assert.sameValue(table.has(anchor), false);
  } else { assert.throws(TypeError, () => builder.make(values)); }
  assert.compareArray(values, [anchor, key, peer, anchor]);
}
