/*---
description: "Three overlapping windows keep one shared byte coherent after writes at a window's end middle and start through readonly tuples of windows local offsets and byte values."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-destructuring]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }

// Three overlapping windows keep one shared byte coherent after writes at a window's end middle and start; route: readonly tuples of windows local offsets and byte values.
// Node prints views-sharing-readonly-three-windows:ok.
type BufferStorage = number[];
type View = LocalView;
const buffer: BufferStorage = localArrayBuffer(10), whole: View = localDataView(buffer);
const first: View = localDataView(buffer, 1, 5), second: View = localDataView(buffer, 3, 5), third: View = localDataView(buffer, 5, 4);
const rows: readonly [View, number, number, readonly number[]][] = [
  [first, 4, 1, [0, 0, 0, 0, 0, 1, 0, 0, 0, 0]],
  [second, 2, 128, [0, 0, 0, 0, 0, 128, 0, 0, 0, 0]],
  [third, 0, 255, [0, 0, 0, 0, 0, 255, 0, 0, 0, 0]]
];
for (const [view, relative, value, expected] of rows) {
  localSetUint8(view, relative, value); assert.sameValue(view.buffer === buffer, true);
  assert.sameValue(localGetUint8(first, 4), value); assert.sameValue(localGetUint8(second, 2), value); assert.sameValue(localGetUint8(third, 0), value);
  const observed: number[] = []; for (let i = 0; i < 10; i++) observed[i] = localGetUint8(whole, i);
  assert.compareArray(observed, expected);
}
console.log("views-sharing-readonly-three-windows:ok");
