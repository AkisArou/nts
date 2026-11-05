/*---
description: "Closures resize and read the current buffer and view after replacement through captured let bindings. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions]
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
// Closures resize and read the current buffer and view after replacement; route: captured let bindings.
// Node prints buffers-resize-captured-let-rebound:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
let buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 8 });
let view: View = localDataView(buffer);
const resize = (size: number): void => localResize(buffer, size), readLength = (): number => localByteLength(view);
localSetUint8(view, 0, 7); const firstBuffer = buffer, firstView = view;
resize(6); assert.sameValue(readLength(), 6);
buffer = localArrayBuffer(2, { maxByteLength: 8 }); view = localDataView(buffer);
localSetUint8(view, 0, 9); localSetUint8(view, 1, 8); resize(4);
assert.sameValue(readLength(), 4); assert.sameValue(view.buffer === buffer, true);
assert.sameValue(firstView.buffer === firstBuffer, true); assert.sameValue(localByteLength(firstView), 6);
assert.sameValue(localGetUint8(firstView, 0), 7);
const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
assert.compareArray(bytes, [9, 8, 0, 0]);
console.log("buffers-resize-captured-let-rebound:ok");
