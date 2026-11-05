/*---
description: "ToReversed preserves clamped or floating receiver kind and exact special values across dispatch through an interface with two array-backed implementations. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-interfaces, ts-class, ts-class-fields, ts-unions, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
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
function localUint8ClampedArray(input: readonly number[]): LocalView { return localConstruct(input, 1, "Uint8ClampedArray"); }
function localFloat64Array(input: readonly number[]): LocalView { return localConstruct(input, 8, "Float64Array"); }
function localToReversed(view: LocalView): LocalView {
  const out: number[] = []; for (let i = 0; i < view.length; i++) out[i] = view.elements[view.offset + view.length - 1 - i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// ToReversed preserves clamped or floating receiver kind and exact special values across dispatch; route: an interface with two array-backed implementations. Node prints copies-to-reversed-interface-kinds:ok.
type Bytes = LocalView;
type Wide = LocalView;
type View = Bytes | Wide;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
interface CopyStore { data: View; copy(): View; }
class ByteStore implements CopyStore { data: Bytes = localUint8ClampedArray([0, 255, 7]); copy(): View { return localToReversed(this.data); } }
class WideStore implements CopyStore { data: Wide = localFloat64Array([-0, NaN, 1.5]); copy(): View { return localToReversed(this.data); } }
const rows: readonly [CopyStore, boolean, readonly number[], readonly number[]][] = [
  [new ByteStore(), true, [0, 255, 7], [7, 255, 0]], [new WideStore(), false, [-0, NaN, 1.5], [1.5, NaN, -0]],
];
for (const [store, bytes, input, expected] of rows) {
  const result: View = store.copy();
  assert.sameValue(localKind(result, "Uint8ClampedArray"), bytes); assert.sameValue(localKind(result, "Float64Array"), !bytes);
  assert.sameValue(result.buffer === store.data.buffer, false); assert.sameValue(result === store.data, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(store.data), input);
}
console.log("copies-to-reversed-interface-kinds:ok");
