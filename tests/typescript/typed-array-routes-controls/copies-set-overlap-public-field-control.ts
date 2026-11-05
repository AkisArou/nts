/*---
description: "Set snapshots a same-kind source view before an overlapping write changes that shared source through a public byte-array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-null-undefined, ts-destructuring]
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
function localSet(view: LocalView, source: LocalView | readonly number[], offset: number = 0): void {
  if (offset < 0 || offset + source.length > view.length) throw new RangeError();
  const saved: number[] = []; for (let i = 0; i < source.length; i++) saved[i] = "elements" in source ? localGet(source, i) : source[i];
  for (let i = 0; i < saved.length; i++) localWriteIndex(view, offset + i, saved[i]);
}
function localSubarray(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length); return localView(view.elements, view.offset + first, last < first ? 0 : last - first, view.unit, view.kind);
}
// Set snapshots a same-kind source view before an overlapping write changes that shared source; route: a public byte-array field. Node prints copies-set-overlap-public-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox { data: View; constructor(input: readonly number[]) { this.data = localUint8Array(input); } }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 1, 2, 3, 4, 7, 8]],
  [[200, 7, 128, 9, 77, 88, 99, 111], [200, 7, 200, 7, 128, 9, 99, 111]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = localSubarray(box.data, 0, 4), buffer = box.data.buffer;
  const result: void = localSet(box.data, source, 2);
  assert.sameValue(result, undefined); assert.sameValue(box.data.buffer, buffer); assert.sameValue(source.buffer, buffer);
  assert.compareArray(elements(box.data), expected);
  assert.compareArray(elements(source), [expected[0], expected[1], expected[2], expected[3]]);
}
console.log("copies-set-overlap-public-field:ok");
