/*---
description: "Empty and reversed slice ranges still allocate a fresh zero-offset array of the receiver kind through a static Uint32 array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-static, ts-readonly, ts-instanceof]
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
function localUint32Array(input: readonly number[]): LocalView { return localConstruct(input, 4, "Uint32Array"); }
function localBound(index: number, length: number): number { const n = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1; return n < 0 ? n < -length ? 0 : length + n : n > length ? length : n; }
function localSlice(view: LocalView, start: number = 0, end: number = view.length): LocalView {
  const first = localBound(start, view.length), last = localBound(end, view.length), out: number[] = [];
  for (let i = first; i < last; i++) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Empty and reversed slice ranges still allocate a fresh zero-offset array of the receiver kind; route: a static Uint32 array field. Node prints copies-slice-empty-static-field:ok.
type View = LocalView;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class WordBank { static data: View = localUint32Array([]); }
const inputs: readonly (readonly number[])[] = [[], [0], [4294967295, 0, 7, 8]];
for (const input of inputs) {
  WordBank.data = localUint32Array(input);
  const result: View = localSlice(WordBank.data, 3, 1);
  assert.sameValue(localKind(result, "Uint32Array"), true); assert.sameValue(result === WordBank.data, false);
  assert.sameValue(result.buffer === WordBank.data.buffer, false); assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.length, 0); assert.compareArray(elements(result), []);
  assert.compareArray(elements(WordBank.data), input);
}
console.log("copies-slice-empty-static-field:ok");
