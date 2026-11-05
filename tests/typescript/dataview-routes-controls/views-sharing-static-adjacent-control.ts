/*---
description: "Adjacent DataView windows write only their own bytes including the two sides of their shared boundary through static fields holding adjacent windows over one buffer."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }

// Adjacent DataView windows write only their own bytes including the two sides of their shared boundary; route: static fields holding adjacent windows over one buffer.
// Node prints views-sharing-static-adjacent:ok.
type BufferStorage = number[];
type View = LocalView;
class AdjacentWindows {
  static buffer: BufferStorage = localArrayBuffer(8);
  static whole: View = localDataView(AdjacentWindows.buffer);
  static left: View = localDataView(AdjacentWindows.buffer, 0, 4);
  static right: View = localDataView(AdjacentWindows.buffer, 4, 4);
}
for (let i = 0; i < 4; i++) { localSetUint8(AdjacentWindows.left, i, i + 1); localSetUint8(AdjacentWindows.right, i, i + 10); }
localSetUint8(AdjacentWindows.left, 3, 255); localSetUint8(AdjacentWindows.right, 0, 128);
assert.sameValue(localGetUint8(AdjacentWindows.left, 3), 255); assert.sameValue(localGetUint8(AdjacentWindows.right, 0), 128);
assert.sameValue(AdjacentWindows.left.buffer === AdjacentWindows.right.buffer, true);
assert.sameValue(AdjacentWindows.whole.buffer === AdjacentWindows.buffer, true);
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = localGetUint8(AdjacentWindows.whole, i);
assert.compareArray(observed, [1, 2, 3, 255, 128, 11, 12, 13]);
console.log("views-sharing-static-adjacent:ok");
