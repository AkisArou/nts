/*---
description: "A fixed view becomes unreadable when out of bounds and revives with zeroed truncated bytes through a private fixed view. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples]
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
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
// A fixed view becomes unreadable when out of bounds and revives with zeroed truncated bytes; route: a private fixed view.
// Node prints buffers-resize-fixed-private-revival:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class FixedStore {
  buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 8 });
  #view: View = localDataView(this.buffer, 0, 4);
  read(): View { return this.#view; }
}
const store = new FixedStore(), view = store.read();
for (let i = 0; i < 4; i++) localSetUint8(view, i, i + 1);
const rows: readonly [number, readonly number[]][] = [[2, [1, 2, 0, 0]], [0, [0, 0, 0, 0]]];
for (const [size, expected] of rows) {
  localResize(store.buffer, size);
  assert.throws(TypeError, () => localByteLength(view)); assert.throws(TypeError, () => localGetUint8(view, 0));
  localResize(store.buffer, 4); assert.sameValue(localByteLength(view), 4);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-resize-fixed-private-revival:ok");
