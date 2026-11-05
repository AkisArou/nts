/*---
description: "Overlapping DataViews observe writes from either sibling at the shared byte and preserve every other byte through public fields holding two offset views and their whole-buffer view."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-this]
---*/

// Overlapping DataViews observe writes from either sibling at the shared byte and preserve every other byte; route: public fields holding two offset views and their whole-buffer view.
// Node prints views-sharing-public-overlap:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class SharingPair {
  buffer: BufferStorage = new ArrayBuffer(8);
  whole: View = new DataView(this.buffer);
  left: View = new DataView(this.buffer, 1, 4);
  right: View = new DataView(this.buffer, 3, 4);
}
for (const value of [1, 128, 255]) {
  const pair = new SharingPair(); pair.left.setUint8(2, value);
  assert.sameValue(pair.right.getUint8(0), value);
  pair.right.setUint8(1, 17); assert.sameValue(pair.left.getUint8(3), 17);
  assert.sameValue(pair.left.buffer === pair.right.buffer, true); assert.sameValue(pair.whole.buffer === pair.buffer, true);
  const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = pair.whole.getUint8(i);
  assert.compareArray(observed, [0, 0, 0, value, 17, 0, 0, 0]);
}
console.log("views-sharing-public-overlap:ok");
