/*---
description: "Only the view without an explicit length grows with its backing buffer through two implementations of a window store interface. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples]
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
function localResize(buffer: LocalBuffer, length: number): void {
  if (buffer.detached || !buffer.grow) throw new TypeError("fixed"); if (length < 0 || length > buffer.max) throw new RangeError("maximum");
  for (let i = buffer.bytes.length; i < length; i++) buffer.bytes[i] = 0; buffer.bytes.length = length;
}
// Only the view without an explicit length grows with its backing buffer; route: two implementations of a window store interface.
// Node prints buffers-resize-window-interface:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
interface WindowStore { buffer: BufferStorage; view: View; }
class TrackingWindow implements WindowStore {
  buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 10 }); view: View = localDataView(this.buffer);
}
class FixedWindow implements WindowStore {
  buffer: BufferStorage = localArrayBuffer(4, { maxByteLength: 10 }); view: View = localDataView(this.buffer, 0, 4);
}
const stores: readonly [WindowStore, boolean][] = [[new TrackingWindow(), true], [new FixedWindow(), false]];
for (const [store, tracking] of stores) for (const size of [6, 10, 4]) {
  localResize(store.buffer, size);
  assert.sameValue(localByteLength(store.view), tracking ? size : 4);
  assert.sameValue(store.view.buffer === store.buffer, true);
}
console.log("buffers-resize-window-interface:ok");
