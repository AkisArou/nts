/*---
description: "BigInt64Array.toReversed preserves exact converted contents and separate storage through readonly-tuple."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-bigint, ts-readonly, ts-type-aliases]
---*/
// BigInt64Array.toReversed crosses the readonly-tuple route; node reverses only the view, retains its element kind, and leaves its source and storage unchanged.
const log: string[] = [];
type Carrier = readonly [string, BigInt64Array];
function check(route: Carrier, before: bigint[], expected: bigint[]): void {
  const source = route[1];
  const buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength; log.length = 0;
  const result = source.toReversed();
  const again = route[1];
  assert.compareArray(log, []);
  assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(result instanceof BigInt64Array, true); assert.sameValue(Array.isArray(result), false);
  assert.compareArray(Array.from(result), expected); assert.sameValue(result.length, before.length);
  assert.sameValue(result.buffer === buffer, false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, before.length * 8);
  assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
  if (result.length > 0) result[0] = 99n;
  assert.compareArray(Array.from(again), before);
}
const rows: [bigint[], bigint[], bigint[]][] = [[[], [], []], [[9007199254740993n], [9007199254740993n], [9007199254740993n]], [[9223372036854775808n, -9223372036854775809n, 18446744073709551617n, -1n], [-9223372036854775808n, 9223372036854775807n, 1n, -1n], [-1n, 1n, 9223372036854775807n, -9223372036854775808n]]];
for (const [raw, before, expected] of rows) {
  const buffer = new ArrayBuffer((raw.length + 2) * 8), view = new BigInt64Array(buffer, 8, raw.length); view.set(raw);
  check(["view", view], before, expected);
}
