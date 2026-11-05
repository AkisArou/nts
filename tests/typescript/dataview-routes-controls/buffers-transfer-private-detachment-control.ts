/*---
description: "Transfer detaches every old view while keeping its buffer identity and all moved bytes through a private buffer moved through a class method. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-errors, ts-arrow-functions]
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
function localTransfer(buffer: LocalBuffer, length: number = buffer.bytes.length, fixed: boolean = false): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); if (length < 0 || buffer.grow && !fixed && length > buffer.max) throw new RangeError("maximum");
  const result = localArrayBuffer(length, buffer.grow && !fixed ? { maxByteLength: buffer.max } : undefined);
  for (let i = 0; i < length && i < buffer.bytes.length; i++) result.bytes[i] = buffer.bytes[i]; buffer.bytes.length = 0; buffer.detached = true; return result;
}
// Transfer detaches every old view while keeping its buffer identity and all moved bytes; route: a private buffer moved through a class method.
// Node prints buffers-transfer-private-detachment:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
class MoveStore {
  #buffer: BufferStorage; constructor(buffer: BufferStorage) { this.#buffer = buffer; }
  move(): BufferStorage { return localTransfer(this.#buffer); }
}
const samples: readonly (readonly number[])[] = [[], [7], [1, 2, 3, 4]];
for (const sample of samples) {
  const buffer: BufferStorage = localArrayBuffer(sample.length), old: View = localDataView(buffer), store = new MoveStore(buffer);
  for (let i = 0; i < sample.length; i++) localSetUint8(old, i, sample[i]);
  const moved = store.move(), view: View = localDataView(moved);
  assert.sameValue(buffer.bytes.length, 0); assert.sameValue(buffer.detached, true); assert.sameValue(old.buffer === buffer, true);
  assert.throws(TypeError, () => localGetUint8(old, 0)); assert.throws(TypeError, () => localByteLength(old));
  assert.throws(TypeError, () => localByteOffset(old)); assert.throws(TypeError, () => localDataView(buffer));
  const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, sample); assert.sameValue(moved === buffer, false);
}
console.log("buffers-transfer-private-detachment:ok");
