/*---
description: "A view at offset four of a four byte buffer is empty with omitted or zero length and cannot access a byte through a guarded Map get."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined, ts-arrow-functions, ts-errors]
---*/

// A view at offset four of a four byte buffer is empty with omitted or zero length and cannot access a byte; route: a guarded Map get. Node prints views-window-end-zero-map:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = new ArrayBuffer(input.length), view: View = new DataView(buffer);
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return buffer;
}
const backing: BufferStorage = makeBuffer([10, 20, 30, 40]);
const buffers: Map<string, BufferStorage> = new Map([["packet", backing]]);
const selected = buffers.get("packet");
if (selected === undefined) throw new Error("missing buffer");
const windows: readonly View[] = [new DataView(selected, 4), new DataView(selected, 4, 0)];
for (const view of windows) {
  assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 0); assert.sameValue(view.buffer, backing);
  assert.compareArray(readBytes(view), []);
  assert.throws(RangeError, () => view.getUint8(0)); assert.throws(RangeError, () => view.setUint8(0, 255));
}
assert.compareArray(readBytes(new DataView(backing)), [10, 20, 30, 40]);
console.log("views-window-end-zero-map:ok");
