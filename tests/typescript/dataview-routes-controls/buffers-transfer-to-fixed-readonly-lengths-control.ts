/*---
description: "TransferToFixedLength copies the prefix and can grow beyond the old resizable maximum through readonly tuples of target lengths. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples]
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
// TransferToFixedLength copies the prefix and can grow beyond the old resizable maximum; route: readonly tuples of target lengths.
// Node prints buffers-transfer-to-fixed-readonly-lengths:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
const rows: readonly [number, readonly number[]][] = [[0, []], [2, [1, 2]], [4, [1, 2, 3, 4]], [10, [1, 2, 3, 4, 0, 0, 0, 0, 0, 0]]];
for (const [length, expected] of rows) {
  const source: BufferStorage = localArrayBuffer(4, { maxByteLength: 6 }), before: View = localDataView(source);
  for (let i = 0; i < 4; i++) localSetUint8(before, i, i + 1);
  const moved = localTransferToFixedLength(source, length), view: View = localDataView(moved);
  assert.sameValue(source.detached, true); assert.sameValue(moved.bytes.length, length);
  assert.sameValue(moved.grow, false); assert.sameValue(moved.max, length);
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-to-fixed-readonly-lengths:ok");
