/*---
description: "Slice normalizes negative fractional infinite and reversed bounds into an independent byte range through readonly tuples of slice boundaries. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
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
// Slice normalizes negative fractional infinite and reversed bounds into an independent byte range; route: readonly tuples of slice boundaries.
// Node prints buffers-slice-readonly-boundaries:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
const rows: readonly [number, number | undefined, readonly number[]][] = [
  [-1, undefined, [5]], [3, 1, []], [-9, 99, [1, 2, 3, 4, 5]], [1.9, 4.9, [2, 3, 4]],
  [NaN, 2, [1, 2]], [Infinity, undefined, []], [-Infinity, Infinity, [1, 2, 3, 4, 5]], [0, 0, []]
];
for (const [start, end, expected] of rows) {
  const source: BufferStorage = localArrayBuffer(5), before: View = localDataView(source);
  for (let i = 0; i < 5; i++) localSetUint8(before, i, i + 1);
  const copy = localSlice(source, start, end), view: View = localDataView(copy);
  assert.sameValue(copy === source, false); assert.sameValue(copy.bytes.length, expected.length);
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expected); assert.sameValue(source.bytes.length, 5);
}
console.log("buffers-slice-readonly-boundaries:ok");
