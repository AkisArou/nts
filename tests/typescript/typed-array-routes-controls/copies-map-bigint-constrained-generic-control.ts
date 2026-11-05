/*---
description: "Map returns independent signed 64 bit arrays and preserves the converted top bit through both generic instantiations through a constrained generic at two holder type arguments. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-generics, ts-generic-constraints, ts-objects, ts-strings, ts-instanceof, ts-arrow-functions]
---*/

type LocalView = { elements: bigint[]; offset: number; length: number; buffer: bigint[]; byteOffset: number; byteLength: number; kind: string; unit: number };
function localView(elements: bigint[], offset: number, length: number, unit: number, kind: string): LocalView {
  return { elements, offset, length, buffer: elements, byteOffset: offset * unit, byteLength: length * unit, unit, kind };
}
function localEncode(value: bigint, kind: string): bigint { const n = ((value % 18446744073709551616n) + 18446744073709551616n) % 18446744073709551616n; return kind === "BigInt64Array" && n >= 9223372036854775808n ? n - 18446744073709551616n : n; }
function localConstruct(input: readonly bigint[], unit: number, kind: string): LocalView {
  const out: bigint[] = []; for (let i = 0; i < input.length; i++) out[i] = localEncode(input[i], kind); return localView(out, 0, out.length, unit, kind);
}
function localGet(view: LocalView, index: number): bigint { return view.elements[view.offset + index]; }
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localBigInt64Array(input: readonly bigint[]): LocalView { return localConstruct(input, 8, "BigInt64Array"); }
function localMap(view: LocalView, mapper: (value: bigint, index: number, array: LocalView) => bigint): LocalView {
  const out: bigint[] = []; for (let i = 0; i < view.length; i++) out[i] = localEncode(mapper(localGet(view, i), i, view), view.kind); return localView(out, 0, out.length, view.unit, view.kind);
}
// Map returns independent signed 64 bit arrays and preserves the converted top bit through both generic instantiations; route: a constrained generic at two holder type arguments. Node prints copies-map-bigint-constrained-generic:ok.
type View = LocalView;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
type NumberPacket = { data: View; label: number };
type TextPacket = { data: View; label: string };
function project<T extends { data: View }>(packet: T): View { return localMap(packet.data, value => value * 2n); }
const first: View = localBigInt64Array([0n, 2n, 4611686018427387904n]), second: View = localBigInt64Array([-3n, 1n, 7n]);
const left = project<NumberPacket>({ data: first, label: 7 }), right = project<TextPacket>({ data: second, label: "second" });
assert.sameValue(localKind(left, "BigInt64Array"), true); assert.sameValue(localKind(right, "BigInt64Array"), true);
assert.sameValue(left.buffer === first.buffer, false); assert.sameValue(right.buffer === second.buffer, false);
assert.compareArray(elements(left), [0n, 4n, -9223372036854775808n]); assert.compareArray(elements(right), [-6n, 2n, 14n]);
assert.compareArray(elements(first), [0n, 2n, 4611686018427387904n]); assert.compareArray(elements(second), [-3n, 1n, 7n]);
console.log("copies-map-bigint-constrained-generic:ok");
