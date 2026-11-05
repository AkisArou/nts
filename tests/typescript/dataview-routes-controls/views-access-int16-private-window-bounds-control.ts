/*---
description: "Int16 accesses the final fitting word of its private window and failed accesses leave the complete backing bytes unchanged. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
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
function localGetInt16(view: LocalView, offset: number, little = false): number { return localIntegerGet(view, offset, 2, true, little); }
function localSetInt16(view: LocalView, offset: number, value: number, little = false): void { localIntegerSet(view, offset, value, 2, little); }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
// Int16 accesses the final fitting word of its private window and failed accesses leave the complete backing bytes unchanged. Route: a private fixed-window field. Node prints views-access-int16-private-window-bounds:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
class AccessBox {
  #view: View; constructor(view: View) { this.#view = view; }
  read(offset: number): number { return localGetInt16(this.#view, offset, false); }
  write(offset: number, value: number): void { localSetInt16(this.#view, offset, value, false); }
}
const rows: readonly [number, readonly number[]][] = [
  [-2, [90, 90, 90, 90, 90, 255, 254, 90, 90, 90, 90, 90]], [4660, [90, 90, 90, 90, 90, 18, 52, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(12), whole: View = localDataView(buffer), slot = new AccessBox(localDataView(buffer, 3, 4));
  for (let i = 0; i < 12; i++) localSetUint8(whole, i, 90);
  slot.write(2, value); assert.sameValue(slot.read(2), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 4]) {
    assert.throws(RangeError, () => slot.read(offset)); assert.throws(RangeError, () => slot.write(offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-int16-private-window-bounds:ok");
