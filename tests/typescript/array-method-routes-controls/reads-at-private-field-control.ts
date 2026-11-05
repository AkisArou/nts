/*---
description: "at truncates fractional offsets, counts negative offsets from the end and rejects outside indices. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-unions, ts-null-undefined]
---*/

function localAt<T>(items: readonly T[], index: number): T | undefined {
  if (index === Infinity || index === -Infinity) return undefined;
  const whole = index !== index ? 0 : index - index % 1;
  const position = whole < 0 ? items.length + whole : whole;
  for (let i = 0; i < items.length; i++) if (i === position) return items[i];
  return undefined;
}
// at truncates fractional offsets, counts negative offsets from the end and rejects outside indices. Route: a private number-array field. Node prints reads-at-private-field:ok.
class AtReader {
  #items: number[] = [10, 20, 30];
  read(index: number): number | undefined { return localAt(this.#items, index); }
}
const reader = new AtReader();
const indices: readonly number[] = [0, 2, -1, -3, 1.7, -1.7, -0, 3, -4, Infinity, -Infinity, NaN];
const expected: readonly (number | undefined)[] = [10, 30, 30, 10, 20, 30, 10, undefined, undefined, undefined, undefined, 10];
for (let i = 0; i < indices.length; i++) assert.sameValue(reader.read(indices[i]), expected[i]);
console.log("reads-at-private-field:ok");
