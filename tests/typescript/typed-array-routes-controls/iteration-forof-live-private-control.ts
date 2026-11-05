/*---
description: "For-of reads later elements after an earlier iteration changes them. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields]
---*/

function localUint8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function* localValues(data: number[]): IterableIterator<number> { for (let i = 0; i < data.length; i++) yield data[i]; }
// For-of reads later elements after an earlier iteration changes them. Route: a private byte array returned by a declared method.
// Node prints iteration-forof-live-private:ok.
type Values = number[];
class LiveBytes {
  #data: Values = localUint8Array([1, 2, 3]);
  read(): Values { return this.#data; }
  write(index: number, value: number): void { this.#data[index] = value; }
}
for (const replacement of [9, 255]) {
  const holder = new LiveBytes(), seen: number[] = [];
  for (const value of localValues(holder.read())) { seen.push(value); if (seen.length === 1) holder.write(2, replacement); }
  assert.compareArray(seen, [1, 2, replacement]);
}
console.log("iteration-forof-live-private:ok");
