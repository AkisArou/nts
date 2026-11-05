/*---
description: "Negative slice bounds produce a fresh tail whose elements remain independent in both directions through a guarded Map get."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-map-set, ts-strings, ts-null-undefined, ts-instanceof]
---*/

// Negative slice bounds produce a fresh tail whose elements remain independent in both directions; route: a guarded Map get. Node prints copies-slice-negative-map:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
for (const input of [[7, 14, 21, 28, 35], [200, 10, 90, 250, 5]]) {
  const arrays: Map<string, View> = new Map([["sample", new Uint8Array(input)]]);
  const source = arrays.get("sample");
  if (source === undefined) throw new Error("missing array");
  const result: View = source.slice(-2);
  assert.sameValue(result instanceof Uint8Array, true); assert.sameValue(result.buffer === source.buffer, false);
  assert.sameValue(result.length, 2); assert.sameValue(result.byteOffset, 0);
  assert.compareArray(elements(result), [input[3], input[4]]);
  result[0] = 99; source[4] = 66;
  assert.compareArray(elements(result), [99, input[4]]);
  assert.compareArray(elements(source), [input[0], input[1], input[2], input[3], 66]);
}
console.log("copies-slice-negative-map:ok");
