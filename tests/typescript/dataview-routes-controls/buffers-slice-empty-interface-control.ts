/*---
description: "Slicing an empty buffer makes a fresh fixed empty buffer that stays empty when the source grows through two interface implementations for empty sources. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
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
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
function localSliceIndex(value: number, size: number): number { let n = value !== value ? 0 : value === Infinity ? size : value === -Infinity ? 0 : value - value % 1; if (n < 0) n += size; return n < 0 ? 0 : n > size ? size : n; }
function localSlice(buffer: LocalBuffer, start: number = 0, end: number = buffer.bytes.length): LocalBuffer {
  if (buffer.detached) throw new TypeError("detached"); const first = localSliceIndex(start, buffer.bytes.length), last = localSliceIndex(end, buffer.bytes.length);
  const result = localArrayBuffer(last < first ? 0 : last - first); for (let i = 0; i < result.bytes.length; i++) result.bytes[i] = buffer.bytes[first + i]; return result;
}
// Slicing an empty buffer makes a fresh fixed empty buffer that stays empty when the source grows; route: two interface implementations for empty sources.
// Node prints buffers-slice-empty-interface:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
interface EmptyStore { buffer: BufferStorage; copy(): BufferStorage; }
class FixedEmpty implements EmptyStore { buffer: BufferStorage = localArrayBuffer(0); copy(): BufferStorage { return localSlice(this.buffer); } }
class GrowingEmpty implements EmptyStore { buffer: BufferStorage = localArrayBuffer(0, { maxByteLength: 8 }); copy(): BufferStorage { return localSlice(this.buffer); } }
const stores: readonly [EmptyStore, boolean][] = [[new FixedEmpty(), false], [new GrowingEmpty(), true]];
for (const [store, grows] of stores) {
  const copy = store.copy(), view: View = localDataView(copy);
  assert.sameValue(copy === store.buffer, false); assert.sameValue(copy.grow, false); assert.sameValue(copy.max, 0);
  assert.sameValue(copy.detached, false); assert.sameValue(store.buffer.detached, false);
  if (grows) localResize(store.buffer, 4);
  assert.sameValue(localByteLength(view), 0); assert.sameValue(view.buffer === copy, true);
  assert.throws(RangeError, () => localGetUint8(view, 0));
}
console.log("buffers-slice-empty-interface:ok");
