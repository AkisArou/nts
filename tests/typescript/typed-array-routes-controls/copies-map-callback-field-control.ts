/*---
description: "Map converts callback results into a fresh receiver-kind array and later copy writes remain independent through a declared callback field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
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
function localMap(view: LocalView, mapper: (value: number, index: number, array: LocalView) => number): LocalView {
  const out: number[] = []; for (let i = 0; i < view.length; i++) out[i] = localEncode(mapper(localGet(view, i), i, view), view.kind); return localView(out, 0, out.length, view.unit, view.kind);
}
// Map converts callback results into a fresh receiver-kind array and later copy writes remain independent; route: a declared callback field. Node prints copies-map-callback-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class CopyBox {
  data: View;
  mapper: (value: number) => number = value => value * 2;
  constructor(input: readonly number[]) { this.data = localUint8Array(input); }
}
const rows: readonly [readonly number[], readonly number[]][] = [[[200, 100, 1], [144, 200, 2]], [[0, 127, 128], [0, 254, 0]]];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), result: View = localMap(box.data, box.mapper);
  assert.sameValue(localKind(result, "Uint8Array"), true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(box.data), input);
  localWriteIndex(result, 1, 9); assert.compareArray(elements(box.data), input);
}
console.log("copies-map-callback-field:ok");
