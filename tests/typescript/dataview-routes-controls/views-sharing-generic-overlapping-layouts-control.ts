/*---
description: "An overlapping view made from another view's buffer shares exact interior and final-byte writes at different offsets through a constrained layout helper at plain and named layout types."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }

// An overlapping view made from another view's buffer shares exact interior and final-byte writes at different offsets; route: a constrained layout helper at plain and named layout types.
// Node prints views-sharing-generic-overlapping-layouts:ok.
type BufferStorage = number[];
type View = LocalView;
function inspect<T extends { offset: number; length: number; expected: readonly number[] }>(layout: T): void {
  const buffer: BufferStorage = localArrayBuffer(8), whole: View = localDataView(buffer);
  for (let i = 0; i < 8; i++) localSetUint8(whole, i, i + 10);
  const middle: View = localDataView(buffer, layout.offset, layout.length);
  const overlap: View = localDataView(middle.buffer, layout.offset + 1, layout.length - 1);
  localSetUint8(middle, 1, 200); assert.sameValue(localGetUint8(overlap, 0), 200);
  localSetUint8(overlap, layout.length - 2, 255); assert.sameValue(localGetUint8(middle, layout.length - 1), 255);
  assert.sameValue(middle.buffer === overlap.buffer, true); assert.sameValue(overlap.buffer === buffer, true);
  const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = localGetUint8(whole, i);
  assert.compareArray(observed, layout.expected);
}
inspect<{ offset: number; length: number; expected: readonly number[] }>({ offset: 1, length: 3, expected: [10, 11, 200, 255, 14, 15, 16, 17] });
inspect<{ offset: number; length: number; expected: readonly number[]; name: string }>({ offset: 3, length: 4, expected: [10, 11, 12, 13, 200, 15, 255, 17], name: "tail" });
console.log("views-sharing-generic-overlapping-layouts:ok");
