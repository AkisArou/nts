/*---
description: "A one-word Float32 window accepts offset zero and rejects later offsets even when the complete access fits its backing buffer."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-generics, ts-generic-constraints, ts-strings]
---*/

// A one-word Float32 window accepts offset zero and rejects later offsets even when the complete access fits its backing buffer. Route: a constrained window request at plain and named type arguments. Node prints views-access-float32-generic-final-fit:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
function inspect<T extends { value: number; expected: readonly number[] }>(request: T): void {
  const buffer: BufferStorage = new ArrayBuffer(12), whole: View = new DataView(buffer), view: View = new DataView(buffer, 3, 4);
  for (let i = 0; i < 12; i++) whole.setUint8(i, 90);
  view.setFloat32(0, request.value, true); assert.sameValue(view.getFloat32(0, true), request.value); assert.compareArray(readBytes(whole), request.expected);
  for (const offset of [1, 4, 9]) {
    assert.throws(RangeError, () => view.getFloat32(offset, true));
    assert.throws(RangeError, () => view.setFloat32(offset, request.value, true)); assert.compareArray(readBytes(whole), request.expected);
  }
}
const rows: readonly [number, readonly number[]][] = [[1.5, [90, 90, 90, 0, 0, 192, 63, 90, 90, 90, 90, 90]], [-2.5, [90, 90, 90, 0, 0, 32, 192, 90, 90, 90, 90, 90]]];
for (const [value, expected] of rows) {
  inspect<{ value: number; expected: readonly number[] }>({ value, expected });
  inspect<{ value: number; expected: readonly number[]; label: string }>({ value, expected, label: "window" });
}
console.log("views-access-float32-generic-final-fit:ok");
