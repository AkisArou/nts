/*---
description: "Set rejects negative or nonfitting destinations before any write while accepting exact-end and empty sources through readonly source and destination tuples. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-null-undefined, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

type LocalView = { elements: number[]; offset: number; length: number; buffer: number[]; byteOffset: number; byteLength: number; kind: string; unit: number };
function localView(elements: number[], offset: number, length: number, unit: number, kind: string): LocalView {
  return { elements, offset, length, buffer: elements, byteOffset: offset * unit, byteLength: length * unit, unit, kind };
}
function localEncode(value: number, kind: string): number {
  if (kind === "Int8Array" || kind === "Uint8Array") { const n = value !== value || value === Infinity || value === -Infinity ? 0 : value - value % 1; return ((n % 256) + 256) % 256; } return value;
}
function localConstruct(input: readonly number[], unit: number, kind: string): LocalView {
  const out: number[] = []; for (let i = 0; i < input.length; i++) out[i] = localEncode(input[i], kind); return localView(out, 0, out.length, unit, kind);
}
function localGet(view: LocalView, index: number): number { const value = view.elements[view.offset + index]; return view.kind === "Int8Array" && value >= 128 ? value - 256 : value; }
function localWriteIndex(view: LocalView, index: number, value: number): void { if (index >= 0 && index < view.length && index % 1 === 0) view.elements[view.offset + index] = localEncode(value, view.kind); }
function localUint8Array(input: readonly number[]): LocalView { return localConstruct(input, 1, "Uint8Array"); }
function localSet(view: LocalView, source: LocalView | readonly number[], offset: number = 0): void {
  if (offset < 0 || offset + source.length > view.length) throw new RangeError();
  const saved: number[] = []; for (let i = 0; i < source.length; i++) saved[i] = "elements" in source ? localGet(source, i) : source[i];
  for (let i = 0; i < saved.length; i++) localWriteIndex(view, offset + i, saved[i]);
}
// Set rejects negative or nonfitting destinations before any write while accepting exact-end and empty sources; route: readonly source and destination tuples. Node prints copies-set-nonfit-readonly-rows:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
const target: View = localUint8Array([13, 27]);
const rows: readonly [readonly number[], number][] = [[[1, 2, 3], 0], [[9], 2], [[7, 8], 1], [[9], -1]];
for (const [source, offset] of rows) {
  assert.throws(RangeError, () => localSet(target, source, offset));
  assert.compareArray(elements(target), [13, 27]);
}
const tooLong: View = localUint8Array([1, 2, 3]);
assert.throws(RangeError, () => localSet(target, tooLong, 0));
assert.compareArray(elements(target), [13, 27]); assert.compareArray(elements(tooLong), [1, 2, 3]);
assert.sameValue(localSet(target, [99], 1), undefined); assert.compareArray(elements(target), [13, 99]);
assert.sameValue(localSet(target, [], 2), undefined); assert.compareArray(elements(target), [13, 99]);
console.log("copies-set-nonfit-readonly-rows:ok");
