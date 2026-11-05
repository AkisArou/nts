/*---
description: "An array-input constructor copies values before later writes change either side. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-destructuring]
---*/

function localInt16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
// An array-input constructor copies values before later writes change either side. Route: a private Int16 array initialized from a declared number array.
// Node prints construction-input-array-copy-private:ok.
type Samples = number[];
class InputStore {
  #data: Samples; constructor(input: number[]) { this.#data = localInt16Array(input); }
  read(): Samples { return this.#data; }
}
const rows: readonly [number[], readonly number[]][] = [[[1, -2, 3], [1, -2, 3]], [[32767, -32768, 7], [32767, -32768, 7]]];
for (const [input, expected] of rows) {
  const store = new InputStore(input), data = store.read(), before: number[] = [];
  for (let i = 0; i < data.length; i++) before[i] = data[i];
  assert.compareArray(before, expected); input[0] = 99;
  assert.sameValue(data[0], expected[0]); data[1] = 22;
  assert.compareArray(input, [99, expected[1], expected[2]]);
  const after: number[] = []; for (let i = 0; i < data.length; i++) after[i] = data[i];
  assert.compareArray(after, [expected[0], 22, expected[2]]);
}
console.log("construction-input-array-copy-private:ok");
