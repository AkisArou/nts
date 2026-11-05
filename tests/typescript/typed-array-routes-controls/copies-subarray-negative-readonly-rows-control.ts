/*---
description: "Negative and clipped subarray bounds retain exact offsets including empty reversed ranges through readonly bound and expected-value tuples. (control)"
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
function localSubarray(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length); return localView(view.elements, view.offset + first, last < first ? 0 : last - first, view.unit, view.kind);
}
// Negative and clipped subarray bounds retain exact offsets including empty reversed ranges; route: readonly bound and expected-value tuples. Node prints copies-subarray-negative-readonly-rows:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
const source: View = localUint8Array([11, 22, 33, 44, 55]);
const rows: readonly [number, number | undefined, number, readonly number[]][] = [
  [-2, undefined, 3, [44, 55]], [-4, -1, 1, [22, 33, 44]], [3, 1, 3, []],
  [-20, 20, 0, [11, 22, 33, 44, 55]], [5, undefined, 5, []],
];
for (const [start, end, offset, expected] of rows) {
  const part: View = localSubarray(source, start, end);
  assert.sameValue(part.buffer, source.buffer); assert.sameValue(part.byteOffset, offset);
  assert.sameValue(part.length, expected.length); assert.compareArray(elements(part), expected);
  assert.compareArray(elements(source), [11, 22, 33, 44, 55]);
}
console.log("copies-subarray-negative-readonly-rows:ok");
