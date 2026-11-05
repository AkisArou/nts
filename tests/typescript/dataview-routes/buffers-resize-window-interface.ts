/*---
description: "Only the view without an explicit length grows with its backing buffer through two implementations of a window store interface."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples]
---*/

// Only the view without an explicit length grows with its backing buffer; route: two implementations of a window store interface.
// Node prints buffers-resize-window-interface:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
interface WindowStore { buffer: BufferStorage; view: View; }
class TrackingWindow implements WindowStore {
  buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 10 }); view: View = new DataView(this.buffer);
}
class FixedWindow implements WindowStore {
  buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 10 }); view: View = new DataView(this.buffer, 0, 4);
}
const stores: readonly [WindowStore, boolean][] = [[new TrackingWindow(), true], [new FixedWindow(), false]];
for (const [store, tracking] of stores) for (const size of [6, 10, 4]) {
  store.buffer.resize(size);
  assert.sameValue(store.view.byteLength, tracking ? size : 4);
  assert.sameValue(store.view.buffer === store.buffer, true);
}
console.log("buffers-resize-window-interface:ok");
