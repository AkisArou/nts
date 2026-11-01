/*---
description: A bigint reached through an interface field throws TypeError when used as the JSON root.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-bigint, ts-errors, ts-arrow-functions]
---*/
// Read a bigint from an interface field and stringify it as the root; node throws TypeError for every magnitude.
interface JsonBigintRecord { value: bigint; }
for (const n of [-1n, 0n, 9007199254740993n, 18446744073709551616n]) {
  const holder: JsonBigintRecord = { value: n };
  assert.sameValue(holder.value, n);
  assert.throws(TypeError, () => JSON.stringify(holder.value));
}
