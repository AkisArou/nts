/*---
description: "at truncates fractional offsets, counts negative offsets from the end and rejects outside indices."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-unions, ts-null-undefined]
---*/

// at truncates fractional offsets, counts negative offsets from the end and rejects outside indices. Route: a private number-array field. Node prints reads-at-private-field:ok.
class AtReader {
  #items: number[] = [10, 20, 30];
  read(index: number): number | undefined { return this.#items.at(index); }
}
const reader = new AtReader();
const indices: readonly number[] = [0, 2, -1, -3, 1.7, -1.7, -0, 3, -4, Infinity, -Infinity, NaN];
const expected: readonly (number | undefined)[] = [10, 30, 30, 10, 20, 30, 10, undefined, undefined, undefined, undefined, 10];
for (let i = 0; i < indices.length; i++) assert.sameValue(reader.read(indices[i]), expected[i]);
console.log("reads-at-private-field:ok");
