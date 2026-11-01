/*---
description: A cyclic array stored in an interface field throws TypeError when reached through the outer object.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-arrays, ts-objects, ts-unknown, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// Close an array cycle and store it in an interface; node detects the cycle while serializing its elements.
interface JsonCyclicArrayRecord { values: unknown[]; tag: number; }
for (const n of [-2, 0, 7]) {
  const values: unknown[] = [n];
  values.push(values);
  const holder: JsonCyclicArrayRecord = { values, tag: n };
  assert.sameValue(holder.values[1], values);
  assert.sameValue(holder.values.length, 2);
  assert.throws(TypeError, () => JSON.stringify(holder));
}
