/*---
description: "Saved subarrays retain their old buffer while a closure reads the newly assigned parent through a replaced captured byte-array binding. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-closures, ts-arrow-functions]
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
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSubarray(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length); return localView(view.elements, view.offset + first, last < first ? 0 : last - first, view.unit, view.kind);
}
// Saved subarrays retain their old buffer while a closure reads the newly assigned parent; route: a replaced captured byte-array binding. Node prints copies-subarray-captured-parent-replacement:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
let current: View = localUint8Array([1, 2, 3, 4]);
const take = (): View => localSubarray(current, 1, 3);
const saved: View = take(), original: View = current;
current = localUint8Array([10, 20, 30, 40]);
const recent: View = take();
localWriteIndex(saved, 0, 91); localWriteIndex(recent, 1, 81);
assert.sameValue(saved.buffer, original.buffer); assert.sameValue(recent.buffer, current.buffer);
assert.sameValue(saved.buffer === recent.buffer, false);
assert.compareArray(elements(original), [1, 91, 3, 4]); assert.compareArray(elements(current), [10, 20, 81, 40]);
assert.compareArray(elements(saved), [91, 3]); assert.compareArray(elements(recent), [20, 81]);
console.log("copies-subarray-captured-parent-replacement:ok");
