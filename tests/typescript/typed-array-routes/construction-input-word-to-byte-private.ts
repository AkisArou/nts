/*---
description: "Constructing unsigned bytes from signed words wraps values and makes an independent copy."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-destructuring]
---*/

// Constructing unsigned bytes from signed words wraps values and makes an independent copy. Route: a private signed-word source used by a declared copy method.
// Node prints construction-input-word-to-byte-private:ok.
type InputSamples = Int16Array; type OutputSamples = Uint8Array;
class InputStore {
  #data: InputSamples; constructor(values: readonly number[]) { this.#data = new Int16Array(values); }
  copy(): OutputSamples { return new Uint8Array(this.#data); }
  source(): InputSamples { return this.#data; }
}
const rows: readonly [readonly number[], readonly number[]][] = [[[-1, 256, 32767, -32768], [255, 0, 255, 0]], [[257, -257, 0, 128], [1, 255, 0, 128]]];
for (const [values, expected] of rows) {
  const holder = new InputStore(values), source = holder.source(), result = holder.copy(), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.buffer === source.buffer, false);
  source[0] = 13; result[1] = 17;
  assert.sameValue(result[0], expected[0]); assert.sameValue(source[1], values[1]);
}
console.log("construction-input-word-to-byte-private:ok");
