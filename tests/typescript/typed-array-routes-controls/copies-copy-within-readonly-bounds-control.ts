/*---
description: "CopyWithin snapshots overlapping source elements in either direction and normalizes negative or empty ranges through readonly start end and target tuples. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
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
function localUint8Array(input: readonly number[]): LocalView { return localConstruct(input, 1, "Uint8Array"); }
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localCopyWithin(view: LocalView, target: number, start: number, end: number = view.length): LocalView {
  const to = localBound(target, view.length), first = localBound(start, view.length), last = localBound(end, view.length), saved: number[] = [];
  let count = last - first; if (count < 0) count = 0; if (count > view.length - to) count = view.length - to;
  for (let i = 0; i < count; i++) saved[i] = view.elements[view.offset + first + i];
  for (let i = 0; i < count; i++) view.elements[view.offset + to + i] = saved[i]; return view;
}
// CopyWithin snapshots overlapping source elements in either direction and normalizes negative or empty ranges; route: readonly start end and target tuples. Node prints copies-copy-within-readonly-bounds:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
const rows: readonly [number, number, number | undefined, readonly number[]][] = [
  [1, 0, 3, [11, 11, 22, 33, 55]], [0, 2, undefined, [33, 44, 55, 44, 55]],
  [-2, 0, 2, [11, 22, 33, 11, 22]], [0, 4, 2, [11, 22, 33, 44, 55]],
];
for (const [target, start, end, expected] of rows) {
  const source: View = localUint8Array([11, 22, 33, 44, 55]), buffer = source.buffer;
  const result: View = localCopyWithin(source, target, start, end);
  assert.sameValue(result, source); assert.sameValue(result.buffer, buffer);
  assert.compareArray(elements(source), expected); assert.compareArray(elements(result), expected);
}
console.log("copies-copy-within-readonly-bounds:ok");
