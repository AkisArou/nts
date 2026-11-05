/*---
description: "Adjacent DataView windows write only their own bytes including the two sides of their shared boundary through static fields holding adjacent windows over one buffer."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static]
---*/

// Adjacent DataView windows write only their own bytes including the two sides of their shared boundary; route: static fields holding adjacent windows over one buffer.
// Node prints views-sharing-static-adjacent:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class AdjacentWindows {
  static buffer: BufferStorage = new ArrayBuffer(8);
  static whole: View = new DataView(AdjacentWindows.buffer);
  static left: View = new DataView(AdjacentWindows.buffer, 0, 4);
  static right: View = new DataView(AdjacentWindows.buffer, 4, 4);
}
for (let i = 0; i < 4; i++) { AdjacentWindows.left.setUint8(i, i + 1); AdjacentWindows.right.setUint8(i, i + 10); }
AdjacentWindows.left.setUint8(3, 255); AdjacentWindows.right.setUint8(0, 128);
assert.sameValue(AdjacentWindows.left.getUint8(3), 255); assert.sameValue(AdjacentWindows.right.getUint8(0), 128);
assert.sameValue(AdjacentWindows.left.buffer === AdjacentWindows.right.buffer, true);
assert.sameValue(AdjacentWindows.whole.buffer === AdjacentWindows.buffer, true);
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = AdjacentWindows.whole.getUint8(i);
assert.compareArray(observed, [1, 2, 3, 255, 128, 11, 12, 13]);
console.log("views-sharing-static-adjacent:ok");
