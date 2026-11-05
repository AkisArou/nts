/*---
description: "Successive transfers detach each previous generation and zero-fill bytes discarded before regrowth through captured buffer and view bindings. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-errors]
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
function localTransfer(buffer: LocalBuffer, length: number = buffer.bytes.length, fixed: boolean = false): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); if (length < 0 || buffer.grow && !fixed && length > buffer.max) throw new RangeError("maximum");
  const result = localArrayBuffer(length, buffer.grow && !fixed ? { maxByteLength: buffer.max } : undefined);
  for (let i = 0; i < length && i < buffer.bytes.length; i++) result.bytes[i] = buffer.bytes[i]; buffer.bytes.length = 0; buffer.detached = true; return result;
}
// Successive transfers detach each previous generation and zero-fill bytes discarded before regrowth; route: captured buffer and view bindings.
// Node prints buffers-transfer-captured-let-generations:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
let buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 8 });
let view: View = localDataView(buffer);
for (let i = 0; i < 4; i++) localSetUint8(view, i, 10 * (i + 1));
const move = (size: number): void => { buffer = localTransfer(buffer, size); view = localDataView(buffer); };
const rows: readonly [number, readonly number[]][] = [[6, [10, 20, 30, 40, 0, 0]], [2, [10, 20]], [5, [10, 20, 0, 0, 0]]];
for (const [size, expected] of rows) {
  const previous = buffer, oldView = view; move(size);
  assert.sameValue(previous.detached, true); assert.sameValue(oldView.buffer === previous, true);
  assert.throws(TypeError, () => localByteLength(oldView));
  assert.sameValue(view.buffer === buffer, true); assert.sameValue(localByteLength(view), size);
  const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-captured-let-generations:ok");
