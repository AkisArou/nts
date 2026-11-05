/*---
description: "A detached buffer rejects both subsequent transfer operations through a reassigned static buffer field. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static, ts-errors, ts-arrow-functions]
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
function localTransferToFixedLength(buffer: LocalBuffer, length: number = buffer.bytes.length): LocalBuffer { return localTransfer(buffer, length, true); }
// A detached buffer rejects both subsequent transfer operations; route: a reassigned static buffer field.
// Node prints buffers-transfer-detached-static-errors:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class TransferSlot { static buffer: BufferStorage = localArrayBuffer(0); }
for (const size of [0, 1, 4]) {
  TransferSlot.buffer = localArrayBuffer(size, { maxByteLength: 8 });
  const before: View = localDataView(TransferSlot.buffer);
  for (let i = 0; i < size; i++) localSetUint8(before, i, 31 + i);
  const moved = localTransfer(TransferSlot.buffer), view: View = localDataView(moved);
  assert.throws(TypeError, () => localTransfer(TransferSlot.buffer));
  assert.throws(TypeError, () => localTransferToFixedLength(TransferSlot.buffer));
  assert.sameValue(TransferSlot.buffer.detached, true); assert.sameValue(TransferSlot.buffer.bytes.length, 0);
  assert.sameValue(localByteLength(view), size);
  for (let i = 0; i < size; i++) assert.sameValue(localGetUint8(view, i), 31 + i);
}
console.log("buffers-transfer-detached-static-errors:ok");
