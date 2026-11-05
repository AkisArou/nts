/*---
description: "A transferred resizable buffer retains its maximum and can grow again without losing retained bytes through a public resizable buffer field. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
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
function localTransfer(buffer: LocalBuffer, length: number = buffer.bytes.length, fixed: boolean = false): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); if (length < 0 || buffer.grow && !fixed && length > buffer.max) throw new RangeError("maximum");
  const result = localArrayBuffer(length, buffer.grow && !fixed ? { maxByteLength: buffer.max } : undefined);
  for (let i = 0; i < length && i < buffer.bytes.length; i++) result.bytes[i] = buffer.bytes[i]; buffer.bytes.length = 0; buffer.detached = true; return result;
}
// A transferred resizable buffer retains its maximum and can grow again without losing retained bytes; route: a public resizable buffer field.
// Node prints buffers-transfer-resizable-public-metadata:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class MovableStore { buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 12 }); }
const rows: readonly [number | undefined, readonly number[]][] = [
  [undefined, [11, 22, 33, 44, 0, 0, 0, 0, 0, 0, 0, 0]], [2, [11, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], [8, [11, 22, 33, 44, 0, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [length, expected] of rows) {
  const store = new MovableStore(), before: View = localDataView(store.buffer);
  for (let i = 0; i < 4; i++) localSetUint8(before, i, 11 * (i + 1));
  const moved = localTransfer(store.buffer, length), view: View = localDataView(moved);
  assert.sameValue(store.buffer.detached, true); assert.sameValue(moved.grow, true); assert.sameValue(moved.max, 12);
  assert.sameValue(localByteLength(view), length === undefined ? 4 : length);
  localResize(moved, 12); assert.sameValue(localByteLength(view), 12);
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-resizable-public-metadata:ok");
