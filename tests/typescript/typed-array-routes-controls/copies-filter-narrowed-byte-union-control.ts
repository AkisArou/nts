/*---
description: "Filter creates a fresh array of the selected signed or unsigned kind with its exact retained elements through a discriminated union of byte arrays. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-unions, ts-objects, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
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
function localInt8Array(input: readonly number[]): LocalView { return localConstruct(input, 1, "Int8Array"); }
function localUint8Array(input: readonly number[]): LocalView { return localConstruct(input, 1, "Uint8Array"); }
function localFilter(view: LocalView, predicate: (value: number, index: number, array: LocalView) => boolean): LocalView {
  const out: number[] = []; for (let i = 0; i < view.length; i++) if (predicate(localGet(view, i), i, view)) out[out.length] = view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// Filter creates a fresh array of the selected signed or unsigned kind with its exact retained elements; route: a discriminated union of byte arrays. Node prints copies-filter-narrowed-byte-union:ok.
type Signed = LocalView;
type Unsigned = LocalView;
type View = Signed | Unsigned;
type Packet = { kind: "signed"; data: Signed } | { kind: "unsigned"; data: Unsigned };
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
function select(packet: Packet): View { return packet.kind === "signed" ? localFilter(packet.data, value => value < 0) : localFilter(packet.data, value => value > 127); }
const rows: readonly [Packet, readonly number[], readonly number[]][] = [
  [{ kind: "signed", data: localInt8Array([-128, 127, -1, 0]) }, [-128, 127, -1, 0], [-128, -1]],
  [{ kind: "unsigned", data: localUint8Array([0, 255, 7, 128]) }, [0, 255, 7, 128], [255, 128]],
];
for (const [packet, input, expected] of rows) {
  const result: View = select(packet);
  assert.sameValue(localKind(result, "Int8Array"), packet.kind === "signed"); assert.sameValue(localKind(result, "Uint8Array"), packet.kind === "unsigned");
  assert.sameValue(result.buffer === packet.data.buffer, false); assert.sameValue(result === packet.data, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(packet.data), input);
}
console.log("copies-filter-narrowed-byte-union:ok");
