/*---
description: "TransferToFixedLength produces a fixed destination from either kind of source through two implementations of a movable store interface. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-errors, ts-arrow-functions]
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
function localTransferToFixedLength(buffer: LocalBuffer, length: number = buffer.bytes.length): LocalBuffer { return localTransfer(buffer, length, true); }
// TransferToFixedLength produces a fixed destination from either kind of source; route: two implementations of a movable store interface.
// Node prints buffers-transfer-fixed-interface:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
interface Movable { buffer: BufferStorage; move(size: number): BufferStorage; }
class PlainStore implements Movable {
  buffer: BufferStorage = localArrayBuffer(2); move(size: number): BufferStorage { return localTransferToFixedLength(this.buffer, size); }
}
class GrowingStore implements Movable {
  buffer: BufferStorage = localArrayBuffer(2, { maxByteLength: 8 }); move(size: number): BufferStorage { return localTransferToFixedLength(this.buffer, size); }
}
const stores: readonly Movable[] = [new PlainStore(), new GrowingStore()];
for (const store of stores) {
  const before: View = localDataView(store.buffer); localSetUint8(before, 0, 9); localSetUint8(before, 1, 5);
  const moved = store.move(4), view: View = localDataView(moved);
  assert.sameValue(store.buffer.detached, true); assert.sameValue(moved.grow, false); assert.sameValue(moved.max, 4);
  assert.throws(TypeError, () => localResize(moved, 5));
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, [9, 5, 0, 0]);
}
console.log("buffers-transfer-fixed-interface:ok");
