/*---
description: "Uint32 uses the final four bytes of its own window and rejects accesses that fit only the larger backing buffer. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

type LocalView = { buffer: number[]; offset: number; length: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset = 0, length = buffer.length - offset): LocalView { return { buffer, offset, length }; }
function localByteLength(view: LocalView): number { return view.length; }
function localIndex(view: LocalView, offset: number, width: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + width > view.length) throw new RangeError(); return view.offset + offset;
}
function localIntegerGet(view: LocalView, offset: number, width: number, signed: boolean, little = false): number {
  const start = localIndex(view, offset, width); let value = 0; for (let i = 0; i < width; i++) value = value * 256 + view.buffer[start + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value; }
function localIntegerSet(view: LocalView, offset: number, value: number, width: number, little = false): void {
  const start = localIndex(view, offset, width), modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { view.buffer[start + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; } }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[localIndex(view, offset, 1)]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
function localSetUint32(view: LocalView, offset: number, value: number, little = false): void { localIntegerSet(view, offset, value, 4, little); }
function localGetUint32(view: LocalView, offset: number, little = false): number { return localIntegerGet(view, offset, 4, false, little); }
// Uint32 uses the final four bytes of its own window and rejects accesses that fit only the larger backing buffer. Route: a static fixed-window field. Node prints views-access-uint32-static-window-bounds:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
const buffer: BufferStorage = localArrayBuffer(14), whole: View = localDataView(buffer);
class AccessSlot { static view: View = localDataView(buffer, 2, 6); }
const rows: readonly [number, readonly number[]][] = [
  [305419896, [90, 90, 90, 90, 120, 86, 52, 18, 90, 90, 90, 90, 90, 90]],
  [2147483649, [90, 90, 90, 90, 1, 0, 0, 128, 90, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  for (let i = 0; i < 14; i++) localSetUint8(whole, i, 90);
  localSetUint32(AccessSlot.view, 2, value, true); assert.sameValue(localGetUint32(AccessSlot.view, 2, true), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 6]) {
    assert.throws(RangeError, () => localGetUint32(AccessSlot.view, offset, true));
    assert.throws(RangeError, () => localSetUint32(AccessSlot.view, offset, value, true)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-uint32-static-window-bounds:ok");
