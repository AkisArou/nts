/*---
description: "Int8Array.toReversed preserves exact converted contents and separate storage through union."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-class, ts-class-fields, ts-this, ts-narrowing]
---*/
// Int8Array.toReversed crosses the union route; node reverses only the view, retains its element kind, and leaves its source and storage unchanged.
const log: string[] = [];
class Carrier { view: Int8Array; constructor(view: Int8Array) { this.view = view; } }
function check(route: Int8Array | Carrier, before: number[], expected: number[]): void {
  const source = route instanceof Int8Array ? route : route.view;
  const buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength; log.length = 0;
  const result = source.toReversed();
  const again = route instanceof Int8Array ? route : route.view;
  assert.compareArray(log, []);
  assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(result instanceof Int8Array, true); assert.sameValue(Array.isArray(result), false);
  assert.compareArray(Array.from(result), expected); assert.sameValue(result.length, before.length);
  assert.sameValue(result.buffer === buffer, false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, before.length * 1);
  assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
  if (result.length > 0) result[0] = 99;
  assert.compareArray(Array.from(again), before);
}
const rows: [number[], number[], number[]][] = [[[], [], []], [[-7], [-7], [-7]], [[-129, 128, 255, 256, 3.9, -3.9], [127, -128, -1, 0, 3, -3], [-3, 3, 0, -1, -128, 127]]];
for (const [raw, before, expected] of rows) {
  const buffer = new ArrayBuffer((raw.length + 2) * 1), view = new Int8Array(buffer, 1, raw.length); view.set(raw);
  for (const boxed of [false, true]) check(boxed ? new Carrier(view) : view, before, expected);
}
