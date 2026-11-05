/*---
description: "Map returns independent signed 64 bit arrays and preserves the converted top bit through both generic instantiations through a constrained generic at two holder type arguments."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-generics, ts-generic-constraints, ts-objects, ts-strings, ts-instanceof, ts-arrow-functions]
---*/

// Map returns independent signed 64 bit arrays and preserves the converted top bit through both generic instantiations; route: a constrained generic at two holder type arguments. Node prints copies-map-bigint-constrained-generic:ok.
type View = BigInt64Array;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
type NumberPacket = { data: View; label: number };
type TextPacket = { data: View; label: string };
function project<T extends { data: View }>(packet: T): View { return packet.data.map(value => value * 2n); }
const first: View = new BigInt64Array([0n, 2n, 4611686018427387904n]), second: View = new BigInt64Array([-3n, 1n, 7n]);
const left = project<NumberPacket>({ data: first, label: 7 }), right = project<TextPacket>({ data: second, label: "second" });
assert.sameValue(left instanceof BigInt64Array, true); assert.sameValue(right instanceof BigInt64Array, true);
assert.sameValue(left.buffer === first.buffer, false); assert.sameValue(right.buffer === second.buffer, false);
assert.compareArray(elements(left), [0n, 4n, -9223372036854775808n]); assert.compareArray(elements(right), [-6n, 2n, 14n]);
assert.compareArray(elements(first), [0n, 2n, 4611686018427387904n]); assert.compareArray(elements(second), [-3n, 1n, 7n]);
console.log("copies-map-bigint-constrained-generic:ok");
