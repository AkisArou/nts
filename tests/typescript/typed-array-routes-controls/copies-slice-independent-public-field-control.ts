/*---
description: "Slice copies signed elements into independent storage and later writes stay on their own side through a public Int16 array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-instanceof]
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
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSlice(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length), out: number[] = [];
  for (let i = first; i < last; i++) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Slice copies signed elements into independent storage and later writes stay on their own side; route: a public Int16 array field. Node prints copies-slice-independent-public-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox {
  data: View;
  constructor(input: readonly number[]) { this.data = localInt16Array(input); }
  copy(): View { return localSlice(this.data, 1, 3); }
}
for (const input of [[-32768, 7, 32767, 42], [-9, 0, 999, 17]]) {
  const box: CopyBox = new CopyBox(input), result: View = box.copy();
  assert.sameValue(localKind(result, "Int16Array"), true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.sameValue(result.byteOffset, 0); assert.compareArray(elements(result), [input[1], input[2]]);
  localWriteIndex(result, 0, -1234); localWriteIndex(box.data, 2, 2222);
  assert.compareArray(elements(result), [-1234, input[2]]);
  assert.compareArray(elements(box.data), [input[0], input[1], 2222, input[3]]);
}
console.log("copies-slice-independent-public-field:ok");
