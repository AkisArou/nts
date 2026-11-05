/*---
description: "Captured accessors use the current window and offset for successful final-fitting writes and preserve the backing bytes after failures. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-closures]
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
// Captured accessors use the current window and offset for successful final-fitting writes and preserve the backing bytes after failures. Route: reassigned View, offset and value lets captured by typed closures. Node prints views-access-captured-window-replacement:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
const buffer: BufferStorage = localArrayBuffer(12), whole: View = localDataView(buffer);
let selected: View = localDataView(buffer, 0, 2); let position = 0, value = 0;
const read: () => number = () => localGetInt16(selected, position, true);
const write: () => void = () => { localSetInt16(selected, position, value, true); };
const rows: readonly [number, number, number, number, readonly number[]][] = [
  [1, 4, 2, -2, [90, 90, 90, 254, 255, 90, 90, 90, 90, 90, 90, 90]],
  [6, 2, 0, 4660, [90, 90, 90, 90, 90, 90, 52, 18, 90, 90, 90, 90]]
];
for (const [windowOffset, length, last, next, expected] of rows) {
  selected = localDataView(buffer, windowOffset, length); position = last; value = next;
  for (let i = 0; i < 12; i++) localSetUint8(whole, i, 90);
  write(); assert.sameValue(read(), value); assert.compareArray(readBytes(whole), expected);
  for (const invalid of [-1, last + 1]) {
    position = invalid; assert.throws(RangeError, read); assert.throws(RangeError, write); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-captured-window-replacement:ok");
