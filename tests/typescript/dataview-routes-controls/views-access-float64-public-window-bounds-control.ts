/*---
description: "Float64 accepts exactly the final fitting eight-byte word and failed writes preserve every byte of the larger backing buffer. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-this]
---*/

type LocalView = { buffer: number[]; offset: number; length: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset = 0, length = buffer.length - offset): LocalView { return { buffer, offset, length }; }
function localByteLength(view: LocalView): number { return view.length; }
function localIndex(view: LocalView, offset: number, width: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + width > view.length) throw new RangeError(); return view.offset + offset;
}
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[localIndex(view, offset, 1)]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
const localFloat64: readonly [number, readonly number[]][] = [[1.5, [63, 248, 0, 0, 0, 0, 0, 0]], [-2.5, [192, 4, 0, 0, 0, 0, 0, 0]]];
function localGetFloat64(view: LocalView, offset: number, little = false): number {
  const start = localIndex(view, offset, 8); for (const [value, bytes] of localFloat64) { let matches = true; for (let i = 0; i < 8; i++) if (view.buffer[start + i] !== bytes[little ? 7 - i : i]) matches = false; if (matches) return value; }
  throw new RangeError("unlisted bytes"); }
function localSetFloat64(view: LocalView, offset: number, value: number, little = false): void {
  const start = localIndex(view, offset, 8); for (const [input, bytes] of localFloat64) if (Object.is(value, input)) { for (let i = 0; i < 8; i++) view.buffer[start + i] = bytes[little ? 7 - i : i]; return; }
  throw new RangeError("unlisted value"); }
// Float64 accepts exactly the final fitting eight-byte word and failed writes preserve every byte of the larger backing buffer. Route: a public fixed-window field. Node prints views-access-float64-public-window-bounds:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
class AccessBox { view: View; constructor(view: View) { this.view = view; } }
const rows: readonly [number, readonly number[]][] = [
  [1.5, [90, 90, 90, 90, 90, 63, 248, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90]],
  [-2.5, [90, 90, 90, 90, 90, 192, 4, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(18), whole: View = localDataView(buffer), slot = new AccessBox(localDataView(buffer, 3, 10));
  for (let i = 0; i < 18; i++) localSetUint8(whole, i, 90);
  localSetFloat64(slot.view, 2, value, false); assert.sameValue(localGetFloat64(slot.view, 2, false), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, 3, 10]) {
    assert.throws(RangeError, () => localGetFloat64(slot.view, offset, false));
    assert.throws(RangeError, () => localSetFloat64(slot.view, offset, value, false)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-float64-public-window-bounds:ok");
