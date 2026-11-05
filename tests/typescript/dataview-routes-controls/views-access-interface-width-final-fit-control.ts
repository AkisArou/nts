/*---
description: "Each implementation accepts its own final fitting position and rejects a wider access before any backing byte changes. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class]
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
function localGetUint16(view: LocalView, offset: number, little = false): number { return localIntegerGet(view, offset, 2, false, little); }
function localSetUint16(view: LocalView, offset: number, value: number, little = false): void { localIntegerSet(view, offset, value, 2, little); }
function localGetUint32(view: LocalView, offset: number, little = false): number { return localIntegerGet(view, offset, 4, false, little); }
function localSetUint32(view: LocalView, offset: number, value: number, little = false): void { localIntegerSet(view, offset, value, 4, little); }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
// Each implementation accepts its own final fitting position and rejects a wider access before any backing byte changes. Route: an interface with two-byte and four-byte accessor implementations. Node prints views-access-interface-width-final-fit:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
interface WindowAccess { read(view: View, offset: number): number; write(view: View, offset: number, value: number): void; }
class ShortAccess implements WindowAccess { read(view: View, offset: number): number { return localGetUint16(view, offset, false); } write(view: View, offset: number, value: number): void { localSetUint16(view, offset, value, false); } }
class WordAccess implements WindowAccess { read(view: View, offset: number): number { return localGetUint32(view, offset, false); } write(view: View, offset: number, value: number): void { localSetUint32(view, offset, value, false); } }
const rows: readonly [WindowAccess, number, number, readonly number[]][] = [
  [new ShortAccess(), 2, 0x1234, [90, 90, 90, 90, 90, 90, 18, 52, 90, 90]], [new ShortAccess(), 2, 0x8001, [90, 90, 90, 90, 90, 90, 128, 1, 90, 90]],
  [new WordAccess(), 4, 305419896, [90, 90, 90, 90, 18, 52, 86, 120, 90, 90]], [new WordAccess(), 4, 2147483649, [90, 90, 90, 90, 128, 0, 0, 1, 90, 90]]
];
for (const [route, width, value, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(10), whole: View = localDataView(buffer), view: View = localDataView(buffer, 2, 6), last = 6 - width;
  for (let i = 0; i < 10; i++) localSetUint8(whole, i, 90);
  route.write(view, last, value); assert.sameValue(route.read(view, last), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, last + 1]) {
    assert.throws(RangeError, () => route.read(view, offset)); assert.throws(RangeError, () => route.write(view, offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-interface-width-final-fit:ok");
