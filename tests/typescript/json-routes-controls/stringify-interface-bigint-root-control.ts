/*---
description: Control for stringify-interface-bigint-root; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-bigint, ts-errors, ts-arrow-functions]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonBigintRecord { value: bigint; }
for (const n of [-1n, 0n, 9007199254740993n, 18446744073709551616n]) {
  const holder = { value: n };
  assert.sameValue(holder.value, n);
  assert.throws(TypeError, () => JSON.stringify(holder.value));
}
