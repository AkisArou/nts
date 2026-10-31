/*---
description: Closures called after get through a result-widened readonly Map retain their shared live capture.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-function-types, ts-type-aliases, ts-unknown, ts-closures, ts-arrow-functions, ts-spread]
---*/
// Write: Map<string, Operation>.set; read: a readonly view whose function results are unknown.
// Node preserves the exact stored values, runtime kinds and insertion order.
type Operation = (value: number) => number;
function check(n: number): void {
  let offset = n, calls = 0;
  const first: Operation = value => { calls++; return offset + value; };
  const second: Operation = value => { calls++; return offset - value; };
  const map = new Map<string, Operation>();
  map.set("first", first); map.set("second", second);
  const reader: ReadonlyMap<string, (value: number) => unknown> = map;
  offset = n + 10;
  const plus = reader.get("first"), minus = reader.get("second");
  if (plus === undefined || minus === undefined) throw new Test262Error("functions required");
  assert.sameValue(typeof plus, "function"); assert.sameValue(typeof minus, "function");
  assert.sameValue<unknown>(plus, first); assert.sameValue<unknown>(minus, second);
  const a = plus(n + 2), b = minus(n + 2);
  assert.sameValue(a, 2 * n + 12); assert.sameValue(b, 8);
  assert.sameValue(typeof a, "number"); assert.sameValue(typeof b, "number");
  assert.sameValue(calls, 2); assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
}
for (const n of [-3, 0, 7]) check(n);
