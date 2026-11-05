/*---
description: "Subarray offsets count Int16 elements as two bytes without inspecting byte order through a static Int16 array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
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
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localInt16Array(input: readonly number[]): LocalView { return localConstruct(input, 2, "Int16Array"); }
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSubarray(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length); return localView(view.elements, view.offset + first, last < first ? 0 : last - first, view.unit, view.kind);
}
// Subarray offsets count Int16 elements as two bytes without inspecting byte order; route: a static Int16 array field. Node prints copies-subarray-word-offset-static-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class ShortBank { static data: View = localInt16Array([-32768, -7, 32767, 10]); }
const rows: readonly [number, number, readonly number[]][] = [[1, 2, [-7, 32767, 10]], [-1, 6, [10]], [4, 8, []]];
for (const [start, offset, expected] of rows) {
  const part: View = localSubarray(ShortBank.data, start);
  assert.sameValue(localKind(part, "Int16Array"), true); assert.sameValue(part.buffer, ShortBank.data.buffer);
  assert.sameValue(part.byteOffset, offset); assert.sameValue(part.byteLength, expected.length * 2);
  assert.compareArray(elements(part), expected); assert.compareArray(elements(ShortBank.data), [-32768, -7, 32767, 10]);
}
console.log("copies-subarray-word-offset-static-field:ok");
