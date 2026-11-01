/*---
description: A bigint inside a declared tuple causes TypeError after JSON traversal reaches the nested element.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-tuples, ts-arrays, ts-objects, ts-bigint, ts-errors, ts-arrow-functions]
---*/
// Serialize an interface containing a numeric-bigint tuple; node throws TypeError at the bigint element.
interface JsonTupleRecord { label: string; values: [number, bigint]; }
for (const n of [-1n, 0n, 9007199254740993n]) {
  const value: JsonTupleRecord = { label: "entry", values: [7, n] };
  assert.sameValue(value.values.length, 2);
  assert.sameValue(value.values[0], 7); assert.sameValue(value.values[1], n);
  assert.throws(TypeError, () => JSON.stringify(value));
}
