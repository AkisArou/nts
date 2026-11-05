/*---
description: "Nested subarrays compose offsets and share writes in both directions through a private byte-array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-readonly]
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
// Nested subarrays compose offsets and share writes in both directions; route: a private byte-array field. Node prints copies-subarray-nested-private-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly number[]) { this.#data = localUint8Array(input); }
  cut(): View { const middle = localSubarray(this.#data, 1); return localSubarray(middle, 1, 3); }
  original(): View { return this.#data; }
}
for (const input of [[1, 2, 3, 4, 5], [200, 100, 50, 25, 7]]) {
  const box: CopyBox = new CopyBox(input), original: View = box.original(), part: View = box.cut();
  assert.sameValue(part.buffer, original.buffer); assert.sameValue(part.byteOffset, 2); assert.sameValue(part.length, 2);
  assert.compareArray(elements(part), [input[2], input[3]]);
  localWriteIndex(part, 0, 9); localWriteIndex(original, 3, 77);
  assert.compareArray(elements(original), [input[0], input[1], 9, 77, input[4]]);
  assert.compareArray(elements(part), [9, 77]);
}
console.log("copies-subarray-nested-private-field:ok");
