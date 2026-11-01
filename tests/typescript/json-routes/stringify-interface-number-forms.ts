/*---
description: Numbers in an interface keep exact decimal JSON forms while negative zero becomes zero and nonfinite values become null.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-numbers, ts-tuples]
---*/
// Serialize an interface numeric field; node normalizes zero and nonfinite values and emits the explicit decimal or exponent form below.
interface JsonNumberRecord { number: number; keep: boolean; }
const rows: [number, string][] = [
  [-0, "0"], [NaN, "null"], [Infinity, "null"], [-Infinity, "null"], [0.1, "0.1"],
  [2147483649, "2147483649"], [9007199254740994, "9007199254740994"],
  [1e20, "100000000000000000000"], [1e21, "1e+21"], [1e-7, "1e-7"],
];
for (const [number, encoded] of rows) {
  const value: JsonNumberRecord = { number, keep: true };
  assert.sameValue(JSON.stringify(value), `{"number":${encoded},"keep":true}`);
  assert.sameValue(Object.is(value.number, number), true);
}
