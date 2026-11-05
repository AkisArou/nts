/*---
description: "An overlapping view made from another view's buffer shares exact interior and final-byte writes at different offsets through a constrained layout helper at plain and named layout types."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/

// An overlapping view made from another view's buffer shares exact interior and final-byte writes at different offsets; route: a constrained layout helper at plain and named layout types.
// Node prints views-sharing-generic-overlapping-layouts:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function inspect<T extends { offset: number; length: number; expected: readonly number[] }>(layout: T): void {
  const buffer: BufferStorage = new ArrayBuffer(8), whole: View = new DataView(buffer);
  for (let i = 0; i < 8; i++) whole.setUint8(i, i + 10);
  const middle: View = new DataView(buffer, layout.offset, layout.length);
  const overlap: View = new DataView(middle.buffer, layout.offset + 1, layout.length - 1);
  middle.setUint8(1, 200); assert.sameValue(overlap.getUint8(0), 200);
  overlap.setUint8(layout.length - 2, 255); assert.sameValue(middle.getUint8(layout.length - 1), 255);
  assert.sameValue(middle.buffer === overlap.buffer, true); assert.sameValue(overlap.buffer === buffer, true);
  const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = whole.getUint8(i);
  assert.compareArray(observed, layout.expected);
}
inspect<{ offset: number; length: number; expected: readonly number[] }>({ offset: 1, length: 3, expected: [10, 11, 200, 255, 14, 15, 16, 17] });
inspect<{ offset: number; length: number; expected: readonly number[]; name: string }>({ offset: 3, length: 4, expected: [10, 11, 12, 13, 200, 15, 255, 17], name: "tail" });
console.log("views-sharing-generic-overlapping-layouts:ok");
