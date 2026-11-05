/*---
description: "Slice creates independent bytes in both mutation directions through a private buffer exposed through a copy method. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/

type LocalBuffer = { bytes: number[]; max: number; grow: boolean; detached: boolean };
type LocalView = { buffer: LocalBuffer; offset: number; length: number | undefined };
function localArrayBuffer(length: number, options?: { maxByteLength: number }): LocalBuffer {
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0;
  return { bytes, max: options === undefined ? length : options.maxByteLength, grow: options !== undefined, detached: false }; }
function localDataView(buffer: LocalBuffer, offset: number = 0, length?: number): LocalView {
  if (buffer.detached) throw new TypeError("detached"); if (offset < 0 || offset > buffer.bytes.length || length !== undefined && (length < 0 || offset + length > buffer.bytes.length)) throw new RangeError("window");
  return { buffer, offset, length };
}
function localByteLength(view: LocalView): number {
  if (view.buffer.detached || view.offset > view.buffer.bytes.length || view.length !== undefined && view.offset + view.length > view.buffer.bytes.length) throw new TypeError("out of bounds");
  return view.length === undefined ? view.buffer.bytes.length - view.offset : view.length; }
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); return view.buffer.bytes[view.offset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); view.buffer.bytes[view.offset + offset] = (value % 256 + 256) % 256; }
function localSliceIndex(value: number, size: number): number { let n = value !== value ? 0 : value === Infinity ? size : value === -Infinity ? 0 : value - value % 1; if (n < 0) n += size; return n < 0 ? 0 : n > size ? size : n; }
function localSlice(buffer: LocalBuffer, start: number = 0, end: number = buffer.bytes.length): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); const first = localSliceIndex(start, buffer.bytes.length), last = localSliceIndex(end, buffer.bytes.length);
  const result = localArrayBuffer(last < first ? 0 : last - first); for (let i = 0; i < result.bytes.length; i++) result.bytes[i] = buffer.bytes[first + i]; return result;
}
// Slice creates independent bytes in both mutation directions; route: a private buffer exposed through a copy method.
// Node prints buffers-slice-private-independent:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class CopyStore {
  #buffer: BufferStorage = localArrayBuffer(6); view: View = localDataView(this.#buffer);
  copy(start: number, end: number): BufferStorage { return localSlice(this.#buffer, start, end); }
}
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
const rows: readonly [number, number, readonly number[]][] = [[1, 4, [20, 30, 40]], [0, 6, [10, 20, 30, 40, 50, 60]], [2, 2, []]];
for (const [start, end, expected] of rows) {
  const store = new CopyStore(); for (let i = 0; i < 6; i++) localSetUint8(store.view, i, 10 * (i + 1));
  const copy = store.copy(start, end), view: View = localDataView(copy);
  assert.sameValue(copy === store.view.buffer, false); assert.compareArray(readBytes(view), expected);
  localSetUint8(store.view, start, 99); assert.compareArray(readBytes(view), expected);
  if (expected.length > 0) { localSetUint8(view, 0, 77); assert.sameValue(localGetUint8(store.view, start), 99); assert.sameValue(localGetUint8(view, 0), 77); }
}
console.log("buffers-slice-private-independent:ok");
