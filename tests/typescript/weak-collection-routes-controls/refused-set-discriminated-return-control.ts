/*---
description: Strong-collection control. A discriminated-union return carries valid and registered-symbol keys to WeakSet membership methods.
features: [ts-weak-collection-routes, ts-weak-collection-route-refused, ts-map-set, ts-unions, ts-symbols, ts-errors, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-type-aliases]
---*/
// WeakSet keys cross a narrowed union and typed return: node accepts held symbols and objects, rejects registered symbols and preserves prior membership. The control validates insertion and uses identity-keyed Map or Set storage.
type Choice = { kind: "held"; value: object | symbol } | { kind: "registered"; text: string };
function keyOf(choice: Choice): object | symbol { if (choice.kind === "registered") return Symbol.for(choice.text); return choice.value; }
function add(table: Set<object | symbol>, key: object | symbol): Set<object | symbol> { if (typeof key === "symbol" && Symbol.keyFor(key) !== undefined) throw new TypeError(); return table.add(key); }
const choices: Choice[] = [{ kind: "held", value: {} }, { kind: "held", value: [] }, { kind: "held", value: () => 1 }, { kind: "held", value: Symbol("s") }, { kind: "held", value: Symbol.iterator }, { kind: "held", value: Symbol.toStringTag }, { kind: "registered", text: "" }, { kind: "registered", text: "weak" }];
for (const choice of choices) {
  const key: object | symbol = keyOf(choice), alias: object | symbol = keyOf(choice), anchor = {};
  const table: Set<object | symbol> = new Set<object | symbol>();
  assert.sameValue(key, alias); assert.sameValue(add(table, anchor), table); assert.sameValue(table.has(anchor), true);
  assert.sameValue(table.has(key), false); assert.sameValue(table.delete(key), false);
  if (choice.kind === "registered") {
    assert.throws(TypeError, () => add(table, key)); assert.sameValue(table.has(alias), false); assert.sameValue(table.delete(alias), false);
  } else {
    assert.sameValue(add(table, key), table); assert.sameValue(add(table, alias), table); assert.sameValue(table.has(alias), true);
    assert.sameValue(table.delete(alias), true); assert.sameValue(table.delete(key), false); assert.sameValue(table.has(key), false);
  }
  assert.sameValue(table.has(anchor), true); assert.sameValue(table.delete(anchor), true); assert.sameValue(table.delete(anchor), false); assert.sameValue(table.has(anchor), false);
}
