/*---
description: "A resize beyond the maximum throws without changing the existing bytes or length through guarded Map lookups of buffers. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-map-set, ts-strings, ts-errors, ts-arrow-functions]
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
// A resize beyond the maximum throws without changing the existing bytes or length; route: guarded Map lookups of buffers.
// Node prints buffers-resize-map-max-error:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
const stores: Map<string, BufferStorage> = new Map([
  ["small", localArrayBuffer(2, { maxByteLength: 4 })], ["large", localArrayBuffer(3, { maxByteLength: 8 })]
]);
for (const key of ["small", "large"]) {
  const buffer = stores.get(key); if (buffer === undefined) throw new Error("missing buffer");
  const view: View = localDataView(buffer), length = buffer.bytes.length, maximum = buffer.max;
  localSetUint8(view, 0, 17);
  assert.throws(RangeError, () => localResize(buffer, maximum + 1));
  assert.sameValue(buffer.bytes.length, length); assert.sameValue(localGetUint8(view, 0), 17); assert.sameValue(buffer.detached, false);
  localResize(buffer, maximum); assert.sameValue(localByteLength(view), maximum);
  const bytes: number[] = []; for (let i = 1; i < maximum; i++) bytes[i - 1] = localGetUint8(view, i);
  for (const byte of bytes) assert.sameValue(byte, 0);
}
console.log("buffers-resize-map-max-error:ok");
