/*---
description: "Writes to negative, fractional and past-end indices are ignored and reads are undefined."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-null-undefined]
---*/

// Writes to negative, fractional and past-end indices are ignored and reads are undefined. Route: a private fixed-length byte array.
// Node prints conversion-invalid-indices-private:ok.
type Bytes = Uint8Array;
class FixedBytes {
  #data: Bytes = new Uint8Array(2);
  put(index: number, value: number): void { this.#data[index] = value; }
  get(index: number): number | undefined { return this.#data[index]; }
  size(): number { return this.#data.length; }
}
const invalidIndices: readonly number[] = [2, 5, -1, 0.5];
for (const index of invalidIndices) {
  const bytes = new FixedBytes(); bytes.put(index, 99);
  assert.sameValue(bytes.get(index), undefined); assert.sameValue(bytes.size(), 2);
  const actual: (number | undefined)[] = []; for (let i = 0; i < bytes.size(); i++) actual[i] = bytes.get(i);
  assert.compareArray(actual, [0, 0]);
}
console.log("conversion-invalid-indices-private:ok");
