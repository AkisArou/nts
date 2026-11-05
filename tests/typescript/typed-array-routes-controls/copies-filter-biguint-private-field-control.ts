/*---
description: "Filter preserves exact unsigned 64 bit elements and creates independent same-kind storage for partial all and empty results through a private unsigned bigint-array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
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
function localBigUint64Array(input: readonly bigint[]): LocalView { return localConstruct(input, 8, "BigUint64Array"); }
function localFilter(view: LocalView, predicate: (value: bigint, index: number, array: LocalView) => boolean): LocalView {
  const out: bigint[] = []; for (let i = 0; i < view.length; i++) if (predicate(localGet(view, i), i, view)) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Filter preserves exact unsigned 64 bit elements and creates independent same-kind storage for partial all and empty results; route: a private unsigned bigint-array field. Node prints copies-filter-biguint-private-field:ok.
type View = LocalView;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly bigint[]) { this.#data = localBigUint64Array(input); }
  select(): View { return localFilter(this.#data, value => value !== 0n); }
  original(): View { return this.#data; }
}
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[0n, 18446744073709551615n, 1n], [18446744073709551615n, 1n]], [[0n, 0n], []], [[1n, 2n], [1n, 2n]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = box.original(), result: View = box.select();
  assert.sameValue(localKind(result, "BigUint64Array"), true); assert.sameValue(result === source, false);
  assert.sameValue(result.buffer === source.buffer, false); assert.compareArray(elements(result), expected);
  if (result.length > 0) localWriteIndex(result, 0, 9n);
  assert.compareArray(elements(source), input);
}
console.log("copies-filter-biguint-private-field:ok");
