/*---
description: "Reverse changes the selected array in place and returns the same object for empty single odd and even lengths through a reassigned captured byte-array binding. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
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
function localReverse(view: LocalView): LocalView {
  for (let i = 0; i < view.length / 2; i++) { const a = view.offset + i, b = view.offset + view.length - 1 - i, value = view.elements[a]; view.elements[a] = view.elements[b]; view.elements[b] = value; } return view;
}
// Reverse changes the selected array in place and returns the same object for empty single odd and even lengths; route: a reassigned captured byte-array binding. Node prints copies-reverse-captured-binding:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
let current: View = localUint8Array([]);
const flip = (): View => localReverse(current);
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], []], [[255], [255]], [[1, 9, 3, 7], [7, 3, 9, 1]], [[0, 128, 255], [255, 128, 0]],
];
for (const [input, expected] of rows) {
  current = localUint8Array(input);
  const original: View = current, buffer = current.buffer, result: View = flip();
  assert.sameValue(result, original); assert.sameValue(result.buffer, buffer);
  assert.compareArray(elements(current), expected); assert.compareArray(elements(result), expected);
}
console.log("copies-reverse-captured-binding:ok");
