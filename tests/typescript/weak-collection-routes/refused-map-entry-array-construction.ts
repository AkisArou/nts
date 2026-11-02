/*---
description: A widened factory method carries entry tuples to WeakMap construction with exact key acceptance.
features: [ts-weak-collection-routes, ts-weak-collection-route-refused, ts-map-set, ts-unions, ts-symbols, ts-errors, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-unsound-bivariance, ts-class, ts-class-fields, ts-numbers, ts-bigint]
---*/
// WeakMap constructor entries cross a method-bivariant array parameter: node rejects refused keys and preserves alias overwrite and present undefined for accepted keys.
type Input = object | symbol | string | number | boolean | bigint | null | undefined;
function eligible(value: Input): boolean { return typeof value === "symbol" ? Symbol.keyFor(value) === undefined : typeof value === "function" || typeof value === "object" && value !== null; }
class Token { id: number; constructor(id: number) { this.id = id; } }
const rows: [Input, Input, boolean][] = [
  [{ id: 1 }, { id: 1 }, true], [[1], [1], true], [() => 1, () => 1, true], [new Token(1), new Token(1), true],
  [Symbol("same"), Symbol("same"), true], [Symbol.iterator, Symbol.toStringTag, true], [Symbol.for(""), Symbol.for(""), false], [Symbol.for("weak"), Symbol.for("weak"), false],
  [null, null, false], [undefined, undefined, false], [false, false, false], [true, true, false], ["", "", false], ["1", "1", false],
  [0, 0, false], [-0, -0, false], [NaN, NaN, false], [Infinity, Infinity, false], [-Infinity, -Infinity, false], [0n, 0n, false], [1n, 1n, false],
];
interface Builder { make(entries: [Input, unknown][]): WeakMap<object | symbol, unknown>; }
const builder: Builder = { make(entries: [object | symbol, unknown][]): WeakMap<object | symbol, unknown> { return new WeakMap<object | symbol, unknown>(entries); } };
for (const [key, peer, accepted] of rows) {
  const anchor = {}, marker = {}, replacement = {}; const entries: [Input, unknown][] = [[anchor, marker], [key, undefined], [peer, marker], [anchor, replacement]];
  assert.sameValue(eligible(key), accepted);
  if (eligible(key)) {
    const table: WeakMap<object | symbol, unknown> = builder.make(entries);
    if ((typeof key === "symbol" || typeof key === "function" || typeof key === "object" && key !== null) && (typeof peer === "symbol" || typeof peer === "function" || typeof peer === "object" && peer !== null)) {
      assert.sameValue(table.has(key), true); assert.sameValue(table.get(key), undefined); assert.sameValue(table.get(anchor), replacement); assert.sameValue(table.has(anchor), true);
      assert.sameValue(table.has(peer), true); assert.sameValue(table.get(peer), marker);
      assert.sameValue(table.set(key, replacement), table); assert.sameValue(table.get(key), replacement);
      assert.sameValue(table.delete(key), true); assert.sameValue(table.delete(key), false); assert.sameValue(table.has(key), false); assert.sameValue(table.get(key), undefined);
      assert.sameValue(table.has(peer), true); assert.sameValue(table.get(peer), marker); assert.sameValue(table.delete(peer), true); assert.sameValue(table.delete(peer), false); assert.sameValue(table.has(peer), false); assert.sameValue(table.get(peer), undefined);
    } else { assert.sameValue(true, false); }
    assert.sameValue(table.delete(anchor), true); assert.sameValue(table.delete(anchor), false); assert.sameValue(table.has(anchor), false); assert.sameValue(table.get(anchor), undefined);
  } else { assert.throws(TypeError, () => builder.make(entries)); }
  assert.compareArray(entries.map(entry => entry[0]), [anchor, key, peer, anchor]); assert.compareArray(entries.map(entry => entry[1]), [marker, undefined, marker, replacement]);
}
