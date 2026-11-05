/*---
description: "Constructing signed bytes from unsigned bytes converts each value into independent storage."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-tuples, ts-destructuring]
---*/

// Constructing signed bytes from unsigned bytes converts each value into independent storage. Route: a public unsigned-byte source field.
// Node prints construction-input-unsigned-to-signed-field:ok.
type InputSamples = Uint8Array; type OutputSamples = Int8Array;
class InputStore { data: InputSamples; constructor(values: readonly number[]) { this.data = new Uint8Array(values); } }
const rows: readonly [readonly number[], readonly number[]][] = [[[200, 127, 128, 255], [-56, 127, -128, -1]], [[0, 1, 254, 129], [0, 1, -2, -127]]];
for (const [values, expected] of rows) {
  const holder = new InputStore(values), source = holder.data, result: OutputSamples = new Int8Array(holder.data), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.buffer === source.buffer, false);
  source[0] = 42; result[1] = -9;
  assert.sameValue(result[0], expected[0]); assert.sameValue(source[1], values[1]);
}
console.log("construction-input-unsigned-to-signed-field:ok");
