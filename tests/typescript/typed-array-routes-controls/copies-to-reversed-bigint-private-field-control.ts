/*---
description: "ToReversed copies exact signed 64 bit values without sharing later writes through a private BigInt64 array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
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
function localWriteIndex(view: LocalView, index: number, value: bigint): void { if (index >= 0 && index < view.length && index % 1 === 0) view.elements[view.offset + index] = localEncode(value, view.kind); }
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localBigInt64Array(input: readonly bigint[]): LocalView { return localConstruct(input, 8, "BigInt64Array"); }
function localToReversed(view: LocalView): LocalView {
  const out: bigint[] = []; for (let i = 0; i < view.length; i++) out[i] = view.elements[view.offset + view.length - 1 - i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// ToReversed copies exact signed 64 bit values without sharing later writes; route: a private BigInt64 array field. Node prints copies-to-reversed-bigint-private-field:ok.
type View = LocalView;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly bigint[]) { this.#data = localBigInt64Array(input); }
  copy(): View { return localToReversed(this.#data); }
  original(): View { return this.#data; }
}
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[-9223372036854775808n, 1n, 9223372036854775807n], [9223372036854775807n, 1n, -9223372036854775808n]], [[7n, -1n, 0n], [0n, -1n, 7n]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = box.original(), result: View = box.copy();
  assert.sameValue(localKind(result, "BigInt64Array"), true); assert.sameValue(result.buffer === source.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(source), input);
  localWriteIndex(result, 0, 8n); assert.compareArray(elements(source), input);
}
console.log("copies-to-reversed-bigint-private-field:ok");
