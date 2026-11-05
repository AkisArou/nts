/*---
description: "Slice retains each receiver kind and exact signed zero or NaN while allocating independent buffers through a constrained generic at two array type arguments. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-instanceof]
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
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localInt16Array(input: readonly number[]): LocalView { return localConstruct(input, 2, "Int16Array"); }
function localFloat64Array(input: readonly number[]): LocalView { return localConstruct(input, 8, "Float64Array"); }
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSlice(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length), out: number[] = [];
  for (let i = first; i < last; i++) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Slice retains each receiver kind and exact signed zero or NaN while allocating independent buffers; route: a constrained generic at two array type arguments. Node prints copies-slice-kinds-constrained-generic:ok.
type Short = LocalView;
type Wide = LocalView;
type View = Short | Wide;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
function clone<T extends Short | Wide>(view: T): Short | Wide { return localSlice(view, 0); }
const short: Short = localInt16Array([-32768, 7, 32767]), wide: Wide = localFloat64Array([-0, NaN, Infinity]);
const first = clone<Short>(short), second = clone<Wide>(wide);
assert.sameValue(localKind(first, "Int16Array"), true); assert.sameValue(localKind(second, "Float64Array"), true);
assert.sameValue(first.buffer === short.buffer, false); assert.sameValue(second.buffer === wide.buffer, false);
assert.compareArray(elements(first), [-32768, 7, 32767]); assert.compareArray(elements(second), [-0, NaN, Infinity]);
localWriteIndex(first, 1, 99); localWriteIndex(second, 0, 1.5);
assert.compareArray(elements(first), [-32768, 99, 32767]); assert.compareArray(elements(second), [1.5, NaN, Infinity]);
assert.compareArray(elements(short), [-32768, 7, 32767]); assert.compareArray(elements(wide), [-0, NaN, Infinity]);
console.log("copies-slice-kinds-constrained-generic:ok");
