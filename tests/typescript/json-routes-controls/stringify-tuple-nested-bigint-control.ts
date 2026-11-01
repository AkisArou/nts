/*---
description: Control for stringify-tuple-nested-bigint; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-tuples, ts-arrays, ts-objects, ts-bigint, ts-errors, ts-arrow-functions]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonTupleRecord { label: string; values: [number, bigint]; }
for (const n of [-1n, 0n, 9007199254740993n]) {
  const value = { label: "entry", values: [7, n] };
  assert.sameValue(value.values.length, 2);
  assert.sameValue(value.values[0], 7); assert.sameValue(value.values[1], n);
  assert.throws(TypeError, () => JSON.stringify(value));
}
