/*---
description: "For-of keeps high bigint elements exact and observes a write ahead. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-generics, ts-generic-constraints, ts-unions]
---*/

function localBigInt64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localBigUint64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function* localValues(data: bigint[]): IterableIterator<bigint> { for (let i = 0; i < data.length; i++) yield data[i]; }
// For-of keeps high bigint elements exact and observes a write ahead. Route: a constrained generic at signed and unsigned array type arguments.
// Node prints iteration-forof-live-bigint-generic:ok.
type SignedValues = bigint[]; type UnsignedValues = bigint[];
function sameValues<T extends SignedValues | UnsignedValues>(data: T): T { return data; }
function visit<T extends SignedValues | UnsignedValues>(data: T): void {
  const seen: bigint[] = [];
  for (const value of localValues(sameValues(data))) { seen.push(value); if (seen.length === 1) data[2] = 9007199254740993n; }
  assert.compareArray(seen, [1n, 2n, 9007199254740993n]);
}
visit<SignedValues>(localBigInt64Array([1n, 2n, 3n]));
visit<UnsignedValues>(localBigUint64Array([1n, 2n, 3n]));
console.log("iteration-forof-live-bigint-generic:ok");
