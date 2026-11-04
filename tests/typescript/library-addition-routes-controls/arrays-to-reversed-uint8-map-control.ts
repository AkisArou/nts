/*---
description: "Control for arrays-to-reversed-uint8-map; Uint8Array.toReversed preserves exact converted contents and separate storage through map."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-map-set, ts-narrowing, ts-errors]
---*/
// Uint8Array.toReversed crosses the map route; node reverses only the view, retains its element kind, and leaves its source and storage unchanged. The control uses older indexed loops in place of the new method.
const log: string[] = [];
function check(route: Map<string, Uint8Array>, before: number[], expected: number[]): void {
  const source = route.get("view"); if (source === undefined) throw new Error("missing view");
  const buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength; log.length = 0;
  const length = source.length, result = new Uint8Array(length);
  for (let k = 0; k < length; k++) result[k] = source[length - 1 - k];
  const again = route.get("view"); if (again === undefined) throw new Error("missing view");
  assert.compareArray(log, []);
  assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(result instanceof Uint8Array, true); assert.sameValue(Array.isArray(result), false);
  assert.compareArray(Array.from(result), expected); assert.sameValue(result.length, before.length);
  assert.sameValue(result.buffer === buffer, false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, before.length * 1);
  assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
  if (result.length > 0) result[0] = 99;
  assert.compareArray(Array.from(again), before);
}
const rows: [number[], number[], number[]][] = [[[], [], []], [[7], [7], [7]], [[-1, 256, 257, 3.9, NaN, Infinity], [255, 0, 1, 3, 0, 0], [0, 0, 3, 1, 0, 255]]];
for (const [raw, before, expected] of rows) {
  const buffer = new ArrayBuffer((raw.length + 2) * 1), view = new Uint8Array(buffer, 1, raw.length); view.set(raw);
  check(new Map<string, Uint8Array>([["view", view]]), before, expected);
}
