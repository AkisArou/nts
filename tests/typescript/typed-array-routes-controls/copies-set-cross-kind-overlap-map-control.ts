/*---
description: "Set snapshots signed byte values from an overlapping one-byte alias before unsigned conversion changes the source view through a guarded Map get. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-map-set, ts-strings, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
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
function localInt8Array(input: number[], offset: number, length: number): LocalView { return localView(input, offset, length, 1, "Int8Array"); }
function localSet(view: LocalView, source: LocalView | readonly number[], offset: number = 0): void {
  if (offset < 0 || offset + source.length > view.length) throw new RangeError();
  const saved: number[] = []; for (let i = 0; i < source.length; i++) saved[i] = "elements" in source ? localGet(source, i) : source[i];
  for (let i = 0; i < saved.length; i++) localWriteIndex(view, offset + i, saved[i]);
}
// Set snapshots signed byte values from an overlapping one-byte alias before unsigned conversion changes the source view; route: a guarded Map get. Node prints copies-set-cross-kind-overlap-map:ok.
type Unsigned = LocalView;
type Signed = LocalView;
type View = Unsigned | Signed;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
const rows: readonly [readonly number[], readonly number[], readonly number[], readonly number[]][] = [
  [[200, 100, 50, 25], [-56, 100], [200, 200, 100, 25], [-56, -56]],
  [[255, 128, 7, 11], [-1, -128], [255, 255, 128, 11], [-1, -1]],
];
for (const [input, before, expected, after] of rows) {
  const arrays: Map<string, Unsigned> = new Map([["sample", localUint8Array(input)]]), target = arrays.get("sample");
  if (target === undefined) throw new Error("missing array");
  const source: Signed = localInt8Array(target.buffer, 0, 2);
  assert.compareArray(elements(source), before); assert.sameValue(source.buffer, target.buffer);
  const result: void = localSet(target, source, 1);
  assert.sameValue(result, undefined); assert.compareArray(elements(target), expected); assert.compareArray(elements(source), after);
}
console.log("copies-set-cross-kind-overlap-map:ok");
