/*---
description: Strong-collection control. WeakSet methods accept widened union arguments through a declared interface and enforce weak-key eligibility.
features: [ts-weak-collection-routes, ts-weak-collection-route-refused, ts-map-set, ts-unions, ts-symbols, ts-errors, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-unsound-bivariance, ts-class, ts-class-fields, ts-numbers, ts-bigint]
---*/
// WeakSet through a method-bivariant interface and runtime union checks: node rejects primitive and registered-symbol additions while lookups and deletion remain quiet. The control validates insertion and uses identity-keyed Map or Set storage.
type Input = object | symbol | string | number | boolean | bigint | null | undefined;
function eligible(value: Input): boolean { return typeof value === "symbol" ? Symbol.keyFor(value) === undefined : typeof value === "function" || typeof value === "object" && value !== null; }
class Token { id: number; constructor(id: number) { this.id = id; } }
const rows: [Input, Input, boolean][] = [
  [{ id: 1 }, { id: 1 }, true], [[1], [1], true], [() => 1, () => 1, true], [new Token(1), new Token(1), true],
  [Symbol("same"), Symbol("same"), true], [Symbol.iterator, Symbol.toStringTag, true], [Symbol.for(""), Symbol.for(""), false], [Symbol.for("weak"), Symbol.for("weak"), false],
  [null, null, false], [undefined, undefined, false], [false, false, false], [true, true, false], ["", "", false], ["1", "1", false],
  [0, 0, false], [-0, -0, false], [NaN, NaN, false], [Infinity, Infinity, false], [-Infinity, -Infinity, false], [0n, 0n, false], [1n, 1n, false],
];
interface SetPort { has(key: Input): boolean; delete(key: Input): boolean; add(key: Input): SetPort; }
class CheckedSet {
  data: Set<object | symbol> = new Set<object | symbol>();
  has(key: object | symbol): boolean { return this.data.has(key); }
  delete(key: object | symbol): boolean { return this.data.delete(key); }
  add(key: object | symbol): CheckedSet { if (!eligible(key)) throw new TypeError(); assert.sameValue(this.data.add(key), this.data); return this; }
}
for (const [key, peer, accepted] of rows) {
  const raw: CheckedSet = new CheckedSet(); const table: SetPort = raw;
  const anchor = {}; const alias: Input = key;
  assert.sameValue(table, raw); assert.sameValue(eligible(key), accepted); assert.sameValue(table.add(anchor), table);
  assert.sameValue(table.has(key), false); assert.sameValue(table.delete(key), false);
  if (eligible(key)) {
    assert.sameValue(table.add(key), table); assert.sameValue(table.add(alias), table); assert.sameValue(table.has(alias), true);
    assert.sameValue(table.has(peer), false); assert.sameValue(table.delete(peer), false); assert.sameValue(table.add(peer), table);
    assert.sameValue(table.has(key), true); assert.sameValue(table.has(peer), true);
    assert.sameValue(table.delete(alias), true); assert.sameValue(table.delete(key), false); assert.sameValue(table.has(key), false); assert.sameValue(table.has(peer), true);
    assert.sameValue(table.delete(peer), true); assert.sameValue(table.delete(peer), false); assert.sameValue(table.has(peer), false);
  } else {
    assert.throws(TypeError, () => table.add(key)); assert.sameValue(table.has(alias), false); assert.sameValue(table.delete(alias), false);
  }
  assert.sameValue(table.has(anchor), true); assert.sameValue(table.delete(anchor), true); assert.sameValue(table.delete(anchor), false); assert.sameValue(table.has(anchor), false);
}
