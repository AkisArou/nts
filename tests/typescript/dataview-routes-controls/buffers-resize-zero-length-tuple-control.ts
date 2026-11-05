/*---
description: "An explicit zero-length view stays empty while an omitted length tracks growth through a readonly tuple carrying fixed and tracking views. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
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
// An explicit zero-length view stays empty while an omitted length tracks growth; route: a readonly tuple carrying fixed and tracking views.
// Node prints buffers-resize-zero-length-tuple:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
const buffer: BufferStorage = localArrayBuffer(0, { maxByteLength: 8 });
const tracking: View = localDataView(buffer), fixed: View = localDataView(buffer, 0, 0);
const rows: readonly [View, boolean][] = [[tracking, true], [fixed, false]];
for (const size of [4, 0, 8]) {
  localResize(buffer, size);
  for (const [view, follows] of rows) {
    assert.sameValue(localByteLength(view), follows ? size : 0);
    assert.sameValue(localByteOffset(view), 0); assert.sameValue(view.buffer === buffer, true);
    if (!follows || size === 0) assert.throws(RangeError, () => localGetUint8(view, 0));
    else assert.sameValue(localGetUint8(view, 0), 0);
  }
}
console.log("buffers-resize-zero-length-tuple:ok");
