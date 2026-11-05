/*---
description: "Writes through two interface implementations reach their distinct windows and reads observe later whole-buffer writes through an interface with leading-window and trailing-window implementations."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }

// Writes through two interface implementations reach their distinct windows and reads observe later whole-buffer writes; route: an interface with leading-window and trailing-window implementations.
// Node prints views-sharing-interface-window-methods:ok.
type BufferStorage = number[];
type View = LocalView;
interface WindowRoute { view: View; write(value: number): void; }
class LeadingRoute implements WindowRoute {
  view: View; constructor(buffer: BufferStorage) { this.view = localDataView(buffer, 0, 2); }
  write(value: number): void { localSetUint8(this.view, 1, value); }
}
class TrailingRoute implements WindowRoute {
  view: View; constructor(buffer: BufferStorage) { this.view = localDataView(buffer, 4, 2); }
  write(value: number): void { localSetUint8(this.view, 1, value); }
}
const buffer: BufferStorage = localArrayBuffer(6), whole: View = localDataView(buffer);
const rows: readonly [WindowRoute, number, number][] = [[new LeadingRoute(buffer), 1, 17], [new TrailingRoute(buffer), 5, 255]];
for (const [route, absolute, value] of rows) {
  route.write(value); assert.sameValue(localGetUint8(whole, absolute), value);
  localSetUint8(whole, absolute, value - 1); assert.sameValue(localGetUint8(route.view, 1), value - 1);
  assert.sameValue(route.view.buffer === buffer, true);
}
const observed: number[] = []; for (let i = 0; i < 6; i++) observed[i] = localGetUint8(whole, i);
assert.compareArray(observed, [0, 16, 0, 0, 0, 254]);
console.log("views-sharing-interface-window-methods:ok");
