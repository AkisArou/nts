/*---
description: "Writes through two interface implementations reach their distinct windows and reads observe later whole-buffer writes through an interface with leading-window and trailing-window implementations."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Writes through two interface implementations reach their distinct windows and reads observe later whole-buffer writes; route: an interface with leading-window and trailing-window implementations.
// Node prints views-sharing-interface-window-methods:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
interface WindowRoute { view: View; write(value: number): void; }
class LeadingRoute implements WindowRoute {
  view: View; constructor(buffer: BufferStorage) { this.view = new DataView(buffer, 0, 2); }
  write(value: number): void { this.view.setUint8(1, value); }
}
class TrailingRoute implements WindowRoute {
  view: View; constructor(buffer: BufferStorage) { this.view = new DataView(buffer, 4, 2); }
  write(value: number): void { this.view.setUint8(1, value); }
}
const buffer: BufferStorage = new ArrayBuffer(6), whole: View = new DataView(buffer);
const rows: readonly [WindowRoute, number, number][] = [[new LeadingRoute(buffer), 1, 17], [new TrailingRoute(buffer), 5, 255]];
for (const [route, absolute, value] of rows) {
  route.write(value); assert.sameValue(whole.getUint8(absolute), value);
  whole.setUint8(absolute, value - 1); assert.sameValue(route.view.getUint8(1), value - 1);
  assert.sameValue(route.view.buffer === buffer, true);
}
const observed: number[] = []; for (let i = 0; i < 6; i++) observed[i] = whole.getUint8(i);
assert.compareArray(observed, [0, 16, 0, 0, 0, 254]);
console.log("views-sharing-interface-window-methods:ok");
