/*---
description: Control for stringify-interface-array-cycle; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-arrays, ts-objects, ts-unknown, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonCyclicArrayRecord { values: unknown[]; tag: number; }
for (const n of [-2, 0, 7]) {
  const values: unknown[] = [n];
  values.push(values);
  const holder = { values, tag: n };
  assert.sameValue(holder.values[1], values);
  assert.sameValue(holder.values.length, 2);
  assert.throws(TypeError, () => JSON.stringify(holder));
}
