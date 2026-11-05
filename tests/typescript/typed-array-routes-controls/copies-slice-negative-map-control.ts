/*---
description: "Negative slice bounds produce a fresh tail whose elements remain independent in both directions through a guarded Map get. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-map-set, ts-strings, ts-null-undefined, ts-instanceof]
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
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSlice(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length), out: number[] = [];
  for (let i = first; i < last; i++) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Negative slice bounds produce a fresh tail whose elements remain independent in both directions; route: a guarded Map get. Node prints copies-slice-negative-map:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
for (const input of [[7, 14, 21, 28, 35], [200, 10, 90, 250, 5]]) {
  const arrays: Map<string, View> = new Map([["sample", localUint8Array(input)]]);
  const source = arrays.get("sample");
  if (source === undefined) throw new Error("missing array");
  const result: View = localSlice(source, -2);
  assert.sameValue(localKind(result, "Uint8Array"), true); assert.sameValue(result.buffer === source.buffer, false);
  assert.sameValue(result.length, 2); assert.sameValue(result.byteOffset, 0);
  assert.compareArray(elements(result), [input[3], input[4]]);
  localWriteIndex(result, 0, 99); localWriteIndex(source, 4, 66);
  assert.compareArray(elements(result), [99, input[4]]);
  assert.compareArray(elements(source), [input[0], input[1], input[2], input[3], 66]);
}
console.log("copies-slice-negative-map:ok");
