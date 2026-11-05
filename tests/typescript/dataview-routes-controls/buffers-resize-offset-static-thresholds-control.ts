/*---
description: "An offset tracking view distinguishes an empty valid window from an out-of-bounds window through static buffer and offset view fields. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
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
function localByteOffset(view: LocalView): number { localByteLength(view); return view.offset; }
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); return view.buffer.bytes[view.offset + offset]; }
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
// An offset tracking view distinguishes an empty valid window from an out-of-bounds window; route: static buffer and offset view fields.
// Node prints buffers-resize-offset-static-thresholds:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class OffsetStore {
  static buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 8 });
  static view: View = localDataView(OffsetStore.buffer, 2);
}
const rows: readonly [number, number][] = [[8, 6], [2, 0], [1, -1], [5, 3]];
for (const [size, length] of rows) {
  localResize(OffsetStore.buffer, size);
  if (length < 0) {
    assert.throws(TypeError, () => localByteLength(OffsetStore.view));
    assert.throws(TypeError, () => localByteOffset(OffsetStore.view));
  } else {
    assert.sameValue(localByteLength(OffsetStore.view), length); assert.sameValue(localByteOffset(OffsetStore.view), 2);
    if (length === 0) assert.throws(RangeError, () => localGetUint8(OffsetStore.view, 0));
    else assert.sameValue(localGetUint8(OffsetStore.view, 0), 0);
  }
}
console.log("buffers-resize-offset-static-thresholds:ok");
