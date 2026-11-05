/*---
description: "ToReversed returns the same element kind over a fresh buffer and leaves the source independent through a public byte-array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
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
function localUint8Array(input: readonly number[]): LocalView { return localConstruct(input, 1, "Uint8Array"); }
function localToReversed(view: LocalView): LocalView {
  const out: number[] = []; for (let i = 0; i < view.length; i++) out[i] = view.elements[view.offset + view.length - 1 - i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// ToReversed returns the same element kind over a fresh buffer and leaves the source independent; route: a public byte-array field. Node prints copies-to-reversed-public-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox { data: View; constructor(input: readonly number[]) { this.data = localUint8Array(input); } }
const rows: readonly [readonly number[], readonly number[]][] = [[[1, 9, 3, 7], [7, 3, 9, 1]], [[255, 0, 8, 128], [128, 8, 0, 255]]];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), result: View = localToReversed(box.data);
  assert.sameValue(localKind(result, "Uint8Array"), true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(box.data), input);
  localWriteIndex(result, 0, 44); localWriteIndex(box.data, 0, 55);
  assert.compareArray(elements(result), [44, expected[1], expected[2], expected[3]]);
  assert.compareArray(elements(box.data), [55, input[1], input[2], input[3]]);
}
console.log("copies-to-reversed-public-field:ok");
