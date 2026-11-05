/*---
description: "For-of keeps high bigint elements exact and observes a write ahead."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-generics, ts-generic-constraints, ts-unions]
---*/

// For-of keeps high bigint elements exact and observes a write ahead. Route: a constrained generic at signed and unsigned array type arguments.
// Node prints iteration-forof-live-bigint-generic:ok.
type SignedValues = BigInt64Array; type UnsignedValues = BigUint64Array;
function sameValues<T extends SignedValues | UnsignedValues>(data: T): T { return data; }
function visit<T extends SignedValues | UnsignedValues>(data: T): void {
  const seen: bigint[] = [];
  for (const value of sameValues(data)) { seen.push(value); if (seen.length === 1) data[2] = 9007199254740993n; }
  assert.compareArray(seen, [1n, 2n, 9007199254740993n]);
}
visit<SignedValues>(new BigInt64Array([1n, 2n, 3n]));
visit<UnsignedValues>(new BigUint64Array([1n, 2n, 3n]));
console.log("iteration-forof-live-bigint-generic:ok");
