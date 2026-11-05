/*---
description: "With replaces one converted signed byte in a new same-kind buffer without changing its source through a guarded Map get."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-map-set, ts-readonly, ts-tuples, ts-strings, ts-null-undefined, ts-instanceof, ts-destructuring]
---*/

// With replaces one converted signed byte in a new same-kind buffer without changing its source; route: a guarded Map get. Node prints copies-with-signed-map:ok.
type View = Int8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const rows: readonly [number, number, readonly number[]][] = [[0, 200, [-56, 2, 3]], [-1, -129, [1, 2, 127]], [1, 127, [1, 127, 3]]];
for (const [index, value, expected] of rows) {
  const arrays: Map<string, View> = new Map([["sample", new Int8Array([1, 2, 3])]]);
  const source = arrays.get("sample");
  if (source === undefined) throw new Error("missing array");
  const result: View = source.with(index, value);
  assert.sameValue(result instanceof Int8Array, true); assert.sameValue(result.buffer === source.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(source), [1, 2, 3]);
  result[0] = 99; assert.compareArray(elements(source), [1, 2, 3]);
}
console.log("copies-with-signed-map:ok");
