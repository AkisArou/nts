/*---
description: "A slice of a resizable buffer is fixed and survives the source shrinking to zero through a constrained range helper at two type arguments. (control)"
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
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); return view.buffer.bytes[view.offset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= localByteLength(view)) throw new RangeError("offset"); view.buffer.bytes[view.offset + offset] = (value % 256 + 256) % 256; }
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
function localSliceIndex(value: number, size: number): number { let n = value !== value ? 0 : value === Infinity ? size : value === -Infinity ? 0 : value - value % 1; if (n < 0) n += size; return n < 0 ? 0 : n > size ? size : n; }
function localSlice(buffer: LocalBuffer, start: number = 0, end: number = buffer.bytes.length): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); const first = localSliceIndex(start, buffer.bytes.length), last = localSliceIndex(end, buffer.bytes.length);
  const result = localArrayBuffer(last < first ? 0 : last - first); for (let i = 0; i < result.bytes.length; i++) result.bytes[i] = buffer.bytes[first + i]; return result;
}
// A slice of a resizable buffer is fixed and survives the source shrinking to zero; route: a constrained range helper at two type arguments.
// Node prints buffers-slice-generic-resizable-copy:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
function inspect<T extends { start: number; end: number; expected: readonly number[] }>(field: T): void {
  const source: BufferStorage = localArrayBuffer(4, { maxByteLength: 8 }), before: View = localDataView(source);
  for (let i = 0; i < 4; i++) localSetUint8(before, i, 10 * (i + 1));
  const copy = localSlice(source, field.start, field.end), view: View = localDataView(copy);
  assert.sameValue(copy.grow, false); assert.sameValue(copy.max, field.expected.length);
  localResize(source, 0); assert.sameValue(localByteLength(view), field.expected.length);
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, field.expected);
}
inspect<{ start: number; end: number; expected: readonly number[] }>({ start: 0, end: 2, expected: [10, 20] });
inspect<{ start: number; end: number; expected: readonly number[]; name: string }>({ start: 2, end: 4, expected: [30, 40], name: "tail" });
console.log("buffers-slice-generic-resizable-copy:ok");
