/*---
description: "For-of reads later elements after an earlier iteration changes them."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields]
---*/

// For-of reads later elements after an earlier iteration changes them. Route: a private byte array returned by a declared method.
// Node prints iteration-forof-live-private:ok.
type Values = Uint8Array;
class LiveBytes {
  #data: Values = new Uint8Array([1, 2, 3]);
  read(): Values { return this.#data; }
  write(index: number, value: number): void { this.#data[index] = value; }
}
for (const replacement of [9, 255]) {
  const holder = new LiveBytes(), seen: number[] = [];
  for (const value of holder.read()) { seen.push(value); if (seen.length === 1) holder.write(2, replacement); }
  assert.compareArray(seen, [1, 2, replacement]);
}
console.log("iteration-forof-live-private:ok");
