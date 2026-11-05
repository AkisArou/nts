/*---
description: "Three overlapping windows keep one shared byte coherent after writes at a window's end middle and start through readonly tuples of windows local offsets and byte values."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Three overlapping windows keep one shared byte coherent after writes at a window's end middle and start; route: readonly tuples of windows local offsets and byte values.
// Node prints views-sharing-readonly-three-windows:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const buffer: BufferStorage = new ArrayBuffer(10), whole: View = new DataView(buffer);
const first: View = new DataView(buffer, 1, 5), second: View = new DataView(buffer, 3, 5), third: View = new DataView(buffer, 5, 4);
const rows: readonly [View, number, number, readonly number[]][] = [
  [first, 4, 1, [0, 0, 0, 0, 0, 1, 0, 0, 0, 0]],
  [second, 2, 128, [0, 0, 0, 0, 0, 128, 0, 0, 0, 0]],
  [third, 0, 255, [0, 0, 0, 0, 0, 255, 0, 0, 0, 0]]
];
for (const [view, relative, value, expected] of rows) {
  view.setUint8(relative, value); assert.sameValue(view.buffer === buffer, true);
  assert.sameValue(first.getUint8(4), value); assert.sameValue(second.getUint8(2), value); assert.sameValue(third.getUint8(0), value);
  const observed: number[] = []; for (let i = 0; i < 10; i++) observed[i] = whole.getUint8(i);
  assert.compareArray(observed, expected);
}
console.log("views-sharing-readonly-three-windows:ok");
