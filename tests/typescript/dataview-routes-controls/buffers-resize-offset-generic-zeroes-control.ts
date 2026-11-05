/*---
description: "A retained offset view sees zeroes after discarded bytes are grown back through a constrained layout helper at two type arguments. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
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
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); view.buffer.bytes[view.offset + offset] = (value % 256 + 256) % 256; }
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
// A retained offset view sees zeroes after discarded bytes are grown back; route: a constrained layout helper at two type arguments.
// Node prints buffers-resize-offset-generic-zeroes:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
function inspect<T extends { offset: number; expected: readonly number[] }>(field: T): void {
  const buffer: BufferStorage = localArrayBuffer(6, { maxByteLength: 8 }), whole: View = localDataView(buffer);
  for (let i = 0; i < 6; i++) localSetUint8(whole, i, i + 11);
  const view: View = localDataView(buffer, field.offset);
  localResize(buffer, field.offset + 1); localResize(buffer, 8);
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, field.expected); assert.sameValue(localByteOffset(view), field.offset);
}
inspect<{ offset: number; expected: readonly number[] }>({ offset: 0, expected: [11, 0, 0, 0, 0, 0, 0, 0] });
inspect<{ offset: number; expected: readonly number[]; name: string }>({ offset: 3, expected: [14, 0, 0, 0, 0], name: "tail" });
console.log("buffers-resize-offset-generic-zeroes:ok");
