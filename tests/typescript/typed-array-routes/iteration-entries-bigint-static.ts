/*---
description: "Entries keep unsigned high bits and read an updated later element."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-class, ts-class-fields, ts-static, ts-tuples, ts-destructuring]
---*/

// Entries keep unsigned high bits and read an updated later element. Route: a static bigint array field.
// Node prints iteration-entries-bigint-static:ok.
type Values = BigUint64Array;
class WideSamples { static data: Values = new BigUint64Array([9223372036854775808n, 1n, 2n]); }
const seenIndices: number[] = [], seenValues: bigint[] = [];
for (const [index, value] of WideSamples.data.entries()) {
  seenIndices.push(index); seenValues.push(value); if (index === 0) WideSamples.data[2] = 18446744073709551615n;
}
assert.compareArray(seenIndices, [0, 1, 2]);
assert.compareArray(seenValues, [9223372036854775808n, 1n, 18446744073709551615n]);
console.log("iteration-entries-bigint-static:ok");
